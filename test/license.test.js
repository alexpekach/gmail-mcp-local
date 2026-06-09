'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLicenseGate } = require('../src/license');
const { createMcpServer } = require('../src/mcp/server');

const DAY = 86_400_000;

function gate(opts) {
  const state = { val: opts.state || null };
  const calls = { fetch: 0 };
  const g = createLicenseGate({
    apiUrl: 'https://x/_functions/license',
    key: ('key' in opts) ? opts.key : 'K1',
    now: () => opts.now || 1_000_000_000,
    graceDays: opts.graceDays ?? 7,
    checkIntervalMs: opts.checkIntervalMs ?? 3_600_000,
    readState: () => state.val,
    writeState: (o) => { state.val = o; },
    fetchImpl: async () => {
      calls.fetch += 1;
      if (opts.throw) throw new Error('network down');
      return { ok: opts.httpOk ?? true, json: async () => opts.json };
    },
    renewUrl: 'example.com/account',
  });
  return { g, state, calls };
}

test('valid license -> ok and caches last-good', async () => {
  const { g, state } = gate({ json: { valid: true, status: 'ACTIVE', until: '2026-12-31' } });
  const r = await g.check();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'ACTIVE');
  assert.ok(state.val && state.val.lastOkMs, 'last-good timestamp persisted');
});

test('definitive invalid -> not ok, never graced', async () => {
  const { g } = gate({ json: { valid: false, reason: 'expired' }, state: { lastOkMs: 1_000_000_000 } });
  const r = await g.check();
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /expired/);
});

test('network error within grace -> ok (grace)', async () => {
  const now = 1_000_000_000;
  const { g } = gate({ throw: true, now, state: { lastOkMs: now - 2 * DAY } });
  const r = await g.check();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.grace, true);
});

test('network error past grace -> not ok', async () => {
  const now = 1_000_000_000;
  const { g } = gate({ throw: true, now, state: { lastOkMs: now - 30 * DAY } });
  const r = await g.check();
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /grace/);
});

test('no key -> not ok', async () => {
  const { g } = gate({ key: undefined, json: { valid: true } });
  const r = await g.check();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_license_key');
});

test('in-memory cache: second check within interval does not refetch', async () => {
  const { g, calls } = gate({ json: { valid: true } });
  await g.check();
  await g.check();
  assert.strictEqual(calls.fetch, 1);
});

test('server BLOCKS tools/call when the gate fails', async () => {
  const tools = [{ name: 't', description: '', inputSchema: { type: 'object' }, handler: async () => ({ done: true }) }];
  const server = createMcpServer({ tools, deps: { licenseGate: { check: async () => ({ ok: false, message: 'renew please' }) } } });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 't', arguments: {} } });
  assert.strictEqual(r.result.isError, true);
  assert.match(r.result.content[0].text, /License required/);
});

test('server RUNS tool when the gate passes', async () => {
  const tools = [{ name: 't', description: '', inputSchema: { type: 'object' }, handler: async () => ({ done: true }) }];
  const server = createMcpServer({ tools, deps: { licenseGate: { check: async () => ({ ok: true }) } } });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 't', arguments: {} } });
  assert.ok(!r.result.isError);
  assert.match(r.result.content[0].text, /done/);
});

test('no gate configured -> tools run unchanged (OSS/free build)', async () => {
  const tools = [{ name: 't', description: '', inputSchema: { type: 'object' }, handler: async () => ({ done: true }) }];
  const server = createMcpServer({ tools, deps: {} });
  const r = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 't', arguments: {} } });
  assert.ok(!r.result.isError);
});
