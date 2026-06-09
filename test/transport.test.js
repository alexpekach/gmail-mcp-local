'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const { createMcpServer } = require('../src/mcp/server');
const { runStdioServer } = require('../src/mcp/transport');

function collect(stream) {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c.toString('utf8')));
  return () => chunks.join('');
}

test('stdio transport: newline-delimited JSON-RPC in → responses out', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const read = collect(output);
  const server = createMcpServer({
    tools: [{ name: 'echo', description: '', inputSchema: { type: 'object' }, handler: async (a) => ({ ok: true, a }) }],
  });

  const done = runStdioServer({ server, input, output });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { x: 1 } } }) + '\n');
  input.write('this is not json\n');
  input.end();
  await done;

  const lines = read().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = Object.fromEntries(lines.filter((l) => l.id != null).map((l) => [l.id, l]));

  assert.ok(byId[1].result.serverInfo, 'initialize response present');
  assert.ok(byId[2].result.content[0].text.includes('"ok": true'), 'tools/call response present');
  assert.ok(lines.some((l) => l.error && l.error.code === -32700), 'parse error emitted for bad line');
});

test('stdio transport handles a message split across chunks', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const read = collect(output);
  const server = createMcpServer({});

  const done = runStdioServer({ server, input, output });
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' });
  input.write(msg.slice(0, 10));
  input.write(msg.slice(10) + '\n');
  input.end();
  await done;

  const lines = read().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(lines[0].id, 9);
  assert.deepStrictEqual(lines[0].result, {});
});
