'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createMcpServer } = require('../src/mcp/server');

test('initialize returns protocolVersion, tools capability, serverInfo', async () => {
  const server = createMcpServer({ serverInfo: { name: 'gmail-mcp-local', version: '1.2.3' } });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.strictEqual(r.result.protocolVersion, '2024-11-05');
  assert.deepStrictEqual(r.result.capabilities, { tools: {} });
  assert.strictEqual(r.result.serverInfo.version, '1.2.3');
});

test('tools/list returns the public tool shape (no handler leaked)', async () => {
  const tools = [{ name: 't1', description: 'd', inputSchema: { type: 'object' }, handler: async () => ({}) }];
  const server = createMcpServer({ tools });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(r.result.tools.length, 1);
  assert.strictEqual(r.result.tools[0].name, 't1');
  assert.ok(!('handler' in r.result.tools[0]));
});

test('tools/call routes to the handler and wraps text content', async () => {
  const tools = [{ name: 'sum', description: '', inputSchema: { type: 'object' }, handler: async (a) => ({ total: a.x + a.y }) }];
  const server = createMcpServer({ tools });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'sum', arguments: { x: 2, y: 3 } } });
  assert.strictEqual(r.id, 5);
  assert.ok(r.result.content[0].text.includes('"total": 5'));
  assert.ok(!r.result.isError);
});

test('tools/call on a throwing handler returns isError content, not a protocol error', async () => {
  const tools = [{ name: 'boom', description: '', inputSchema: { type: 'object' }, handler: async () => { throw new Error('kaboom'); } }];
  const server = createMcpServer({ tools });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom', arguments: {} } });
  assert.strictEqual(r.result.isError, true);
  assert.match(r.result.content[0].text, /kaboom/);
  assert.strictEqual(r.error, undefined);
});

test('unknown tool → -32602, unknown method → -32601, notification → null', async () => {
  const server = createMcpServer({});
  const a = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
  assert.strictEqual(a.error.code, -32602);
  const b = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'frobnicate' });
  assert.strictEqual(b.error.code, -32601);
  const c = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.strictEqual(c, null);
});

test('non-2.0 message → Invalid Request', async () => {
  const server = createMcpServer({});
  const r = await server.handleMessage({ id: 1, method: 'initialize' });
  assert.strictEqual(r.error.code, -32600);
});
