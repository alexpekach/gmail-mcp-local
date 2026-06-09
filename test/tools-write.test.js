'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildTools } = require('../src/mcp/tools');
const { LocalKeychainProvider, AccountNotFoundError } = require('../src/custody');
const { MemoryKeychainBackend } = require('../src/keychain/memoryKeychainBackend');
const { createMetadataStore } = require('../src/metadata/store');

function toolByName(name) {
  const t = buildTools().find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

// Gmail fake: records calls; `handler(method, path, xOrBody)` supplies responses.
function makeGmail(handler) {
  const calls = [];
  const rec = (method) => async (token, path, x) => { calls.push({ method, token, path, x }); const r = handler && handler(method, path, x); return r === undefined ? {} : r; };
  return {
    calls,
    get: rec('GET'),
    post: rec('POST'),
    patch: rec('PATCH'),
    del: async (token, path) => { calls.push({ method: 'DELETE', token, path }); const r = handler && handler('DELETE', path); return r === undefined ? { deleted: true } : r; },
    grantedScopes: async (token) => { calls.push({ method: 'SCOPES', token }); const r = handler && handler('SCOPES'); return r || []; },
  };
}

const fakeCustody = (overrides = {}) => ({
  getAccessToken: async () => 'TOK',
  updateAccountMeta: async (ref, fields) => ({ ref, ...fields }),
  removeAccount: async (ref) => ({ removed: true, ref }),
  listAccounts: async () => [],
  ...overrides,
});

test('set_tag → custody.updateAccountMeta (end-to-end through a real local provider)', async () => {
  const keychain = new MemoryKeychainBackend();
  const metadata = createMetadataStore();
  const provider = new LocalKeychainProvider({ keychain, metadata, refreshAccessToken: async () => ({ access_token: 'x', expires_in: 3600 }) });
  await provider.putRefreshToken('work', 'RT', { email: 'a@b.com', tag: 'personal' });

  const res = await toolByName('set_tag').handler({ account: 'work', tag: 'clientX' }, { custody: provider });
  assert.strictEqual(res.tag, 'clientX');
  assert.strictEqual((await metadata.get('work')).tag, 'clientX');
  // tag is whitelisted metadata; the token is untouched
  assert.strictEqual(await keychain.get('gmail-mcp-local', 'work'), 'RT');
});

test('set_tag on an unknown account throws AccountNotFound', async () => {
  const provider = new LocalKeychainProvider({ keychain: new MemoryKeychainBackend(), metadata: createMetadataStore(), refreshAccessToken: async () => ({ access_token: 'x' }) });
  await assert.rejects(() => toolByName('set_tag').handler({ account: 'nope', tag: 't' }, { custody: provider }), (e) => e instanceof AccountNotFoundError);
});

test('list_labels reads /users/me/labels', async () => {
  const gmail = makeGmail((m, p) => (m === 'GET' && p === '/users/me/labels' ? { labels: [{ id: 'INBOX' }] } : undefined));
  const res = await toolByName('list_labels').handler({ account: 'work' }, { custody: fakeCustody(), gmail });
  assert.deepStrictEqual(res.labels, [{ id: 'INBOX' }]);
});

test('list_thread_attachments walks all attachment parts', async () => {
  const gmail = makeGmail((m, p) => (m === 'GET' ? {
    messages: [{ id: 'm1', payload: { parts: [
      { filename: 'a.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 100 } },
      { mimeType: 'text/plain', body: {} },
    ] } }],
  } : undefined));
  const res = await toolByName('list_thread_attachments').handler({ account: 'work', thread_id: 'T' }, { custody: fakeCustody(), gmail });
  assert.strictEqual(res.attachments.length, 1);
  assert.deepStrictEqual(res.attachments[0], { message_id: 'm1', attachment_id: 'att1', filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 100 });
});

test('get_attachment returns base64, enforces size cap, decodes text', async () => {
  const data = Buffer.from('hello text').toString('base64url');
  const gmail = makeGmail((m, p) => {
    if (m === 'GET' && p.includes('/attachments/')) return { data, size: 10 };
    if (m === 'GET') return { payload: { parts: [{ filename: 't.txt', mimeType: 'text/plain', body: { attachmentId: 'att1' } }] } };
    return undefined;
  });
  const res = await toolByName('get_attachment').handler({ account: 'work', message_id: 'm1', attachment_id: 'att1' }, { custody: fakeCustody(), gmail });
  assert.strictEqual(res.size_bytes, 10);
  assert.strictEqual(res.mime_type, 'text/plain');
  assert.strictEqual(res.filename, 't.txt');
  assert.strictEqual(res.data_text, 'hello text');

  const gmail2 = makeGmail((m, p) => (p.includes('/attachments/') ? { data, size: 99999 } : {}));
  await assert.rejects(() => toolByName('get_attachment').handler({ account: 'work', message_id: 'm1', attachment_id: 'att1', max_size_bytes: 100 }, { custody: fakeCustody(), gmail: gmail2 }), /exceeds max_size_bytes/);
});

test('check_account_scopes flags write/modify and needs_reauth', async () => {
  const readonly = makeGmail((m) => (m === 'SCOPES' ? ['https://www.googleapis.com/auth/gmail.readonly'] : undefined));
  const r1 = await toolByName('check_account_scopes').handler({ account: 'work' }, { custody: fakeCustody(), gmail: readonly });
  assert.strictEqual(r1.has_write_scope, false);
  assert.strictEqual(r1.needs_reauth, true);

  const full = makeGmail((m) => (m === 'SCOPES' ? ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify'] : undefined));
  const r2 = await toolByName('check_account_scopes').handler({ account: 'work' }, { custody: fakeCustody(), gmail: full });
  assert.strictEqual(r2.has_write_scope, true);
  assert.strictEqual(r2.has_modify_scope, true);
  assert.strictEqual(r2.needs_reauth, false);
});

test('create_draft composes a reply and threads it', async () => {
  const gmail = makeGmail((m, p, x) => {
    if (m === 'GET' && p.includes('/messages/')) return { threadId: 'T', payload: { headers: [{ name: 'Message-ID', value: '<m1>' }] } };
    if (m === 'POST' && p === '/users/me/drafts') return { id: 'draft1', message: { id: 'msg1', threadId: 'T' } };
    return undefined;
  });
  const res = await toolByName('create_draft').handler({ account: 'work', to: ['x@y.com'], subject: 'Re', body: 'hi', reply_to_message_id: 'M1' }, { custody: fakeCustody(), gmail });
  assert.strictEqual(res.draft_id, 'draft1');
  assert.strictEqual(res.thread_id, 'T');
  const post = gmail.calls.find((c) => c.method === 'POST');
  assert.strictEqual(post.x.message.threadId, 'T');
  assert.ok(typeof post.x.message.raw === 'string' && post.x.message.raw.length > 0);
});

test('send_message posts to /messages/send', async () => {
  const gmail = makeGmail((m, p) => (m === 'POST' && p === '/users/me/messages/send' ? { id: 'msg9', threadId: 'T9', labelIds: ['SENT'] } : undefined));
  const res = await toolByName('send_message').handler({ account: 'work', to: ['x@y.com'], subject: 'Hi', body: 'yo' }, { custody: fakeCustody(), gmail });
  assert.strictEqual(res.message_id, 'msg9');
  assert.deepStrictEqual(res.label_ids, ['SENT']);
});

test('send_draft posts the draft id', async () => {
  const gmail = makeGmail((m, p, x) => (m === 'POST' && p === '/users/me/drafts/send' ? { id: 'm', threadId: 't', labelIds: [] } : undefined));
  await toolByName('send_draft').handler({ account: 'work', draft_id: 'D1' }, { custody: fakeCustody(), gmail });
  const post = gmail.calls.find((c) => c.method === 'POST');
  assert.deepStrictEqual(post.x, { id: 'D1' });
});

test('label_thread / label_message send modify bodies', async () => {
  const gmail = makeGmail(() => ({ id: 'X', labelIds: ['STARRED'] }));
  await toolByName('label_thread').handler({ account: 'work', thread_id: 'T', add_label_ids: ['STARRED'], remove_label_ids: ['UNREAD'] }, { custody: fakeCustody(), gmail });
  const c = gmail.calls.find((x) => x.method === 'POST');
  assert.match(c.path, /\/threads\/T\/modify$/);
  assert.deepStrictEqual(c.x, { addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] });
});

test('create_label / update_label / delete_label hit the right verbs', async () => {
  const created = makeGmail(() => ({ id: 'Lbl', name: 'Acme' }));
  const c1 = await toolByName('create_label').handler({ account: 'work', name: 'Acme' }, { custody: fakeCustody(), gmail: created });
  assert.strictEqual(c1.id, 'Lbl');
  const post = created.calls.find((x) => x.method === 'POST');
  assert.strictEqual(post.x.name, 'Acme');

  const patched = makeGmail(() => ({ id: 'Lbl', name: 'Acme2' }));
  await toolByName('update_label').handler({ account: 'work', label_id: 'Lbl', name: 'Acme2' }, { custody: fakeCustody(), gmail: patched });
  assert.strictEqual(patched.calls.find((x) => x.method === 'PATCH').x.name, 'Acme2');

  const deleted = makeGmail(() => ({ deleted: true }));
  const d = await toolByName('delete_label').handler({ account: 'work', label_id: 'Lbl' }, { custody: fakeCustody(), gmail: deleted });
  assert.strictEqual(d.deleted, true);
  assert.strictEqual(deleted.calls.find((x) => x.method === 'DELETE').path, '/users/me/labels/Lbl');
});

test('trash_thread / untrash_thread', async () => {
  const gmail = makeGmail(() => ({ id: 'T', labelIds: ['TRASH'] }));
  await toolByName('trash_thread').handler({ account: 'work', thread_id: 'T' }, { custody: fakeCustody(), gmail });
  await toolByName('untrash_thread').handler({ account: 'work', thread_id: 'T' }, { custody: fakeCustody(), gmail });
  assert.match(gmail.calls[0].path, /\/threads\/T\/trash$/);
  assert.match(gmail.calls[1].path, /\/threads\/T\/untrash$/);
});

test('write/modify tools enforce required args', async () => {
  const deps = { custody: fakeCustody(), gmail: makeGmail(() => ({})) };
  await assert.rejects(() => toolByName('send_message').handler({}, deps), /account is required/);
  await assert.rejects(() => toolByName('create_label').handler({ account: 'work' }, deps), /name is required/);
  await assert.rejects(() => toolByName('delete_label').handler({ account: 'work' }, deps), /label_id is required/);
  await assert.rejects(() => toolByName('set_tag').handler({ account: 'work' }, deps), /tag is required/);
});

test('the registry exposes all 20 tools', () => {
  const names = buildTools().map((t) => t.name);
  assert.strictEqual(names.length, 20);
  for (const n of ['list_accounts', 'connect_account', 'remove_account', 'set_tag', 'search_threads', 'get_thread', 'list_labels', 'list_thread_attachments', 'get_attachment', 'check_account_scopes', 'create_draft', 'send_draft', 'send_message', 'label_thread', 'label_message', 'create_label', 'update_label', 'delete_label', 'trash_thread', 'untrash_thread']) {
    assert.ok(names.includes(n), `missing tool: ${n}`);
  }
});
