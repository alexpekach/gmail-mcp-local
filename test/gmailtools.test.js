'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildTools } = require('../src/mcp/tools');

function toolByName(name) {
  const t = buildTools().find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

test('search_threads: tokenFor → gmail.get(/threads) → mapped results (one API call)', async () => {
  let gotToken = null; let gotPath = null; let gotQuery = null;
  const deps = {
    custody: { getAccessToken: async (ref) => { assert.strictEqual(ref, 'work'); return 'TOK'; } },
    gmail: {
      get: async (token, path, query) => {
        gotToken = token; gotPath = path; gotQuery = query;
        return { threads: [{ id: 't1', snippet: 'hi' }, { id: 't2', snippet: 'yo' }], nextPageToken: 'NPT', resultSizeEstimate: 2 };
      },
    },
  };
  const res = await toolByName('search_threads').handler({ account: 'work', query: 'from:x', max_results: 10 }, deps);
  assert.strictEqual(gotToken, 'TOK');
  assert.strictEqual(gotPath, '/users/me/threads');
  assert.strictEqual(gotQuery.q, 'from:x');
  assert.strictEqual(gotQuery.maxResults, 10);
  assert.deepStrictEqual(res.threads, [{ thread_id: 't1', snippet: 'hi' }, { thread_id: 't2', snippet: 'yo' }]);
  assert.strictEqual(res.next_page_token, 'NPT');
});

test('get_thread: parses messages into readable headers + decoded body', async () => {
  const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const deps = {
    custody: { getAccessToken: async () => 'TOK' },
    gmail: {
      get: async (t, path, q) => {
        assert.match(path, /\/users\/me\/threads\/THREAD/);
        assert.strictEqual(q.format, 'full');
        return {
          id: 'THREAD', snippet: 'snip', historyId: 'h1',
          messages: [{
            id: 'm1', threadId: 'THREAD', labelIds: ['INBOX'], snippet: 's',
            payload: { headers: [{ name: 'From', value: 'a@b.com' }, { name: 'Subject', value: 'Hello' }], mimeType: 'text/plain', body: { data: b64url('hi there') } },
          }],
        };
      },
    },
  };
  const res = await toolByName('get_thread').handler({ account: 'work', thread_id: 'THREAD' }, deps);
  assert.strictEqual(res.thread_id, 'THREAD');
  assert.strictEqual(res.messages[0].from, 'a@b.com');
  assert.strictEqual(res.messages[0].subject, 'Hello');
  assert.strictEqual(res.messages[0].body_text, 'hi there');
});

test('list_accounts returns custody metadata and filters by tag', async () => {
  const deps = {
    custody: {
      listAccounts: async () => [
        { ref: 'work', email: 'a@b.com', tag: 'work', has_refresh_token: true },
        { ref: 'home', email: 'c@d.com', tag: 'personal', has_refresh_token: true },
      ],
    },
  };
  const all = await toolByName('list_accounts').handler({}, deps);
  assert.strictEqual(all.accounts.length, 2);
  const filtered = await toolByName('list_accounts').handler({ tag: 'work' }, deps);
  assert.strictEqual(filtered.accounts.length, 1);
  assert.strictEqual(filtered.accounts[0].ref, 'work');
});

test('connect_account delegates to deps.connect', async () => {
  let called = null;
  const deps = { connect: async (opts) => { called = opts; return { ref: opts.ref, email: 'x@y.com', tag: opts.tag }; } };
  const res = await toolByName('connect_account').handler({ ref: 'work', tag: 'work' }, deps);
  assert.deepStrictEqual(called, { ref: 'work', tag: 'work' });
  assert.strictEqual(res.email, 'x@y.com');
});

test('remove_account delegates to custody.removeAccount', async () => {
  let removed = null;
  const deps = { custody: { removeAccount: async (ref) => { removed = ref; return { removed: true, ref }; } } };
  const res = await toolByName('remove_account').handler({ ref: 'work' }, deps);
  assert.strictEqual(removed, 'work');
  assert.strictEqual(res.removed, true);
});

test('mailbox tools require account / ref', async () => {
  const deps = { custody: { getAccessToken: async () => 'T' }, gmail: { get: async () => ({}) } };
  await assert.rejects(() => toolByName('search_threads').handler({}, deps), /account is required/);
  await assert.rejects(() => toolByName('get_thread').handler({ account: 'work' }, deps), /thread_id is required/);
  await assert.rejects(() => toolByName('remove_account').handler({}, {}), /ref is required/);
});
