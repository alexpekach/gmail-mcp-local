'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildMimeMessage, resolveReplyHeaders } = require('../src/gmail/mime');

const decode = (raw) => Buffer.from(raw, 'base64url').toString('utf-8');
const b64 = (s) => Buffer.from(s).toString('base64');

test('plain-text message has the right headers and base64 body', () => {
  const txt = decode(buildMimeMessage({ to: ['a@b.com'], subject: 'Hi', body: 'hello' }));
  assert.match(txt, /^To: a@b\.com$/m);
  assert.match(txt, /^Subject: Hi$/m);
  assert.match(txt, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(txt.includes(b64('hello')));
});

test('html-only message uses text/html', () => {
  const txt = decode(buildMimeMessage({ subject: 'H', html_body: '<b>hi</b>' }));
  assert.match(txt, /Content-Type: text\/html; charset=UTF-8/);
  assert.ok(txt.includes(b64('<b>hi</b>')));
});

test('body + html_body produce multipart/alternative with both parts', () => {
  const txt = decode(buildMimeMessage({ subject: 'M', body: 'plain', html_body: '<i>rich</i>' }));
  assert.match(txt, /multipart\/alternative; boundary=/);
  assert.ok(txt.includes(b64('plain')));
  assert.ok(txt.includes(b64('<i>rich</i>')));
});

test('attachments produce multipart/mixed with a disposition header', () => {
  const txt = decode(buildMimeMessage({ subject: 'A', body: 'see attached', attachments: [{ filename: 'f.txt', mime_type: 'text/plain', data_base64: b64('FILE') }] }));
  assert.match(txt, /multipart\/mixed; boundary=/);
  assert.match(txt, /Content-Disposition: attachment; filename="f\.txt"/);
  assert.ok(txt.includes(b64('FILE')));
});

test('reply headers are emitted when provided', () => {
  const txt = decode(buildMimeMessage({ subject: 'Re', body: 'x', in_reply_to: '<m1@x>', references: '<r0> <m1@x>' }));
  assert.match(txt, /^In-Reply-To: <m1@x>$/m);
  assert.match(txt, /^References: <r0> <m1@x>$/m);
});

test('resolveReplyHeaders derives threading from the original message', async () => {
  const gmail = {
    get: async (token, path, query) => {
      assert.match(path, /\/users\/me\/messages\/M1/);
      assert.strictEqual(query.format, 'metadata');
      return { threadId: 'T', payload: { headers: [{ name: 'Message-ID', value: '<m1@x>' }, { name: 'References', value: '<r0@x>' }] } };
    },
  };
  const ctx = await resolveReplyHeaders(gmail, 'TOK', 'M1');
  assert.strictEqual(ctx.thread_id, 'T');
  assert.strictEqual(ctx.in_reply_to, '<m1@x>');
  assert.strictEqual(ctx.references, '<r0@x> <m1@x>');
});

test('resolveReplyHeaders returns {} with no reply id', async () => {
  const ctx = await resolveReplyHeaders({ get: async () => { throw new Error('should not be called'); } }, 'TOK', undefined);
  assert.deepStrictEqual(ctx, {});
});
