'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGmailClient } = require('../src/gmail/client');

test('get builds URL + query and sends a Bearer header', async () => {
  let captured = null;
  const gmail = createGmailClient({ httpGet: async (url, headers) => { captured = { url, headers }; return { ok: 1 }; } });
  const out = await gmail.get('TOK', '/users/me/threads', { q: 'from:x', maxResults: 5 });
  assert.deepStrictEqual(out, { ok: 1 });
  assert.match(captured.url, /\/gmail\/v1\/users\/me\/threads\?/);
  assert.match(captured.url, /q=from%3Ax/);
  assert.match(captured.url, /maxResults=5/);
  assert.strictEqual(captured.headers.authorization, 'Bearer TOK');
});

test('post sends a JSON body with the Bearer header', async () => {
  let captured = null;
  const gmail = createGmailClient({ httpSend: async (method, url, headers, body) => { captured = { method, url, headers, body }; return { id: 'd1' }; } });
  const out = await gmail.post('TOK', '/users/me/drafts', { message: { raw: 'R' } });
  assert.strictEqual(out.id, 'd1');
  assert.strictEqual(captured.method, 'POST');
  assert.ok(captured.url.endsWith('/users/me/drafts'));
  assert.strictEqual(captured.headers.authorization, 'Bearer TOK');
  assert.deepStrictEqual(captured.body, { message: { raw: 'R' } });
});

test('patch and del hit the right method + path', async () => {
  const seen = [];
  const gmail = createGmailClient({ httpSend: async (method, url, headers, body) => { seen.push({ method, url, body }); return { id: 'L', name: 'x' }; } });
  await gmail.patch('TOK', '/users/me/labels/L', { name: 'x' });
  await gmail.del('TOK', '/users/me/labels/L');
  assert.strictEqual(seen[0].method, 'PATCH');
  assert.deepStrictEqual(seen[0].body, { name: 'x' });
  assert.strictEqual(seen[1].method, 'DELETE');
  assert.strictEqual(seen[1].body, null);
});

test('grantedScopes parses the tokeninfo scope string', async () => {
  const gmail = createGmailClient({ httpGet: async (url) => { assert.match(url, /tokeninfo\?access_token=TOK/); return { scope: 'https://www.googleapis.com/auth/gmail.readonly openid email' }; } });
  const scopes = await gmail.grantedScopes('TOK');
  assert.deepStrictEqual(scopes, ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email']);
});
