'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createMcpServer } = require('../src/mcp/server');
const { runHttpServer, generateSecret } = require('../src/mcp/httpTransport');

const ECHO_TOOL = {
  name: 'echo',
  description: 'Echo the input back.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  handler: async (args) => ({ echoed: args.text }),
};

function makeServer() {
  return createMcpServer({ tools: [ECHO_TOOL], serverInfo: { name: 'test', version: '0.0.0' } });
}

async function post(url, body, raw = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('http transport: initialize → tools/list → tools/call round trip', async () => {
  const h = await runHttpServer({ server: makeServer(), secret: 'testsecret' });
  try {
    const init = await post(h.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    assert.strictEqual(init.status, 200);
    assert.strictEqual(init.json.result.protocolVersion, '2025-03-26');
    assert.strictEqual(init.json.result.serverInfo.name, 'test');

    const list = await post(h.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.json.result.tools.length, 1);
    assert.strictEqual(list.json.result.tools[0].name, 'echo');

    const call = await post(h.url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } });
    assert.strictEqual(call.status, 200);
    assert.deepStrictEqual(JSON.parse(call.json.result.content[0].text), { echoed: 'hi' });
  } finally {
    await h.close();
  }
});

test('http transport: notification → 202 with no body', async () => {
  const h = await runHttpServer({ server: makeServer(), secret: 'testsecret' });
  try {
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(await res.text(), '');
  } finally {
    await h.close();
  }
});

test('http transport: batch returns array of responses', async () => {
  const h = await runHttpServer({ server: makeServer(), secret: 'testsecret' });
  try {
    const batch = await post(h.url, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    assert.strictEqual(batch.status, 200);
    assert.strictEqual(batch.json.length, 2); // notification produces no entry
  } finally {
    await h.close();
  }
});

test('http transport: wrong secret path → 404, wrong method → 405', async () => {
  const h = await runHttpServer({ server: makeServer(), secret: 'testsecret' });
  try {
    const bad = await fetch(h.url.replace('testsecret', 'WRONG'), { method: 'POST', body: '{}' });
    assert.strictEqual(bad.status, 404);

    const get = await fetch(h.url);
    assert.strictEqual(get.status, 405);
    assert.strictEqual(get.headers.get('allow'), 'POST');
  } finally {
    await h.close();
  }
});

test('http transport: invalid JSON → 400 parse error', async () => {
  const h = await runHttpServer({ server: makeServer(), secret: 'testsecret' });
  try {
    const res = await post(h.url, 'not json {', true);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.error.code, -32700);
  } finally {
    await h.close();
  }
});

test('http transport: tool errors stay in-band as isError results', async () => {
  const boom = { ...ECHO_TOOL, name: 'boom', handler: async () => { throw new Error('kaput'); } };
  const server = createMcpServer({ tools: [boom], serverInfo: { name: 'test', version: '0.0.0' } });
  const h = await runHttpServer({ server, secret: 'testsecret' });
  try {
    const call = await post(h.url, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom', arguments: {} } });
    assert.strictEqual(call.status, 200); // MCP convention: tool failure is a result, not a protocol error
    assert.strictEqual(call.json.result.isError, true);
    assert.match(call.json.result.content[0].text, /kaput/);
  } finally {
    await h.close();
  }
});

test('generateSecret: 32 hex chars, unique', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notStrictEqual(a, b);
});
