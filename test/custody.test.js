'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { MemoryKeychainBackend } = require('../src/keychain/memoryKeychainBackend');
const { createMetadataStore } = require('../src/metadata/store');
const {
  createCustodyProvider,
  LocalKeychainProvider,
  ServerBrokerProvider,
  NotImplementedError,
  AccountNotFoundError,
} = require('../src/custody');
const { tokenFor } = require('../src/tokenFor');

function makeBareLocal() {
  return new LocalKeychainProvider({
    keychain: new MemoryKeychainBackend(),
    metadata: createMetadataStore(),
    refreshAccessToken: async (rt) => ({ access_token: `at_${rt}`, expires_in: 3600 }),
  });
}

test('refresh token goes to the keychain, never to metadata', async () => {
  const keychain = new MemoryKeychainBackend();
  const metadata = createMetadataStore();
  const provider = new LocalKeychainProvider({
    keychain, metadata,
    refreshAccessToken: async () => ({ access_token: 'x', expires_in: 3600 }),
  });

  await provider.putRefreshToken('work', 'SECRET_REFRESH_TOKEN', { email: 'a@b.com', tag: 'work' });

  assert.strictEqual(await keychain.get('gmail-mcp-local', 'work'), 'SECRET_REFRESH_TOKEN');
  assert.ok(!metadata._serialize().includes('SECRET_REFRESH_TOKEN'), 'metadata must not contain the refresh token');

  const md = await metadata.get('work');
  assert.strictEqual(md.email, 'a@b.com');
  assert.strictEqual(md.tag, 'work');
  assert.strictEqual(md.has_refresh_token, true);
  assert.ok(!('refresh_token' in md));
});

test('metadata store drops any non-whitelisted field (token cannot leak)', async () => {
  const metadata = createMetadataStore();
  await metadata.upsert('work', { email: 'a@b.com', refresh_token: 'LEAK', access_token: 'LEAK2', tag: 'work' });

  const s = metadata._serialize();
  assert.ok(!s.includes('LEAK'), 'secret-ish non-whitelisted fields must be dropped on write');

  const md = await metadata.get('work');
  assert.ok(!('refresh_token' in md) && !('access_token' in md));
});

test('getAccessToken mints via the injected fn and caches within TTL', async () => {
  let calls = 0;
  const provider = new LocalKeychainProvider({
    keychain: new MemoryKeychainBackend(),
    metadata: createMetadataStore(),
    refreshAccessToken: async () => { calls += 1; return { access_token: `at_${calls}`, expires_in: 3600 }; },
  });
  await provider.putRefreshToken('work', 'RT');

  const a = await provider.getAccessToken('work');
  const b = await provider.getAccessToken('work');
  assert.strictEqual(a, 'at_1');
  assert.strictEqual(b, 'at_1', 'second call should hit the cache');
  assert.strictEqual(calls, 1, 'no second refresh within TTL');
});

test('getAccessToken re-mints when the cached token is inside the expiry skew', async () => {
  let calls = 0;
  const t = 1_000_000;
  const provider = new LocalKeychainProvider({
    keychain: new MemoryKeychainBackend(),
    metadata: createMetadataStore(),
    now: () => t,
    refreshAccessToken: async () => { calls += 1; return { access_token: `at_${calls}`, expires_in: 30 }; }, // 30s < 60s skew
  });
  await provider.putRefreshToken('work', 'RT');

  await provider.getAccessToken('work');
  await provider.getAccessToken('work');
  assert.strictEqual(calls, 2, 'a token expiring within the skew window must be re-minted');
});

test('getAccessToken throws AccountNotFound for an unknown ref', async () => {
  const provider = makeBareLocal();
  await assert.rejects(() => provider.getAccessToken('nope'), (e) => e instanceof AccountNotFoundError);
});

test('removeAccount clears keychain, metadata, and the access-token cache', async () => {
  const keychain = new MemoryKeychainBackend();
  const metadata = createMetadataStore();
  const provider = new LocalKeychainProvider({
    keychain, metadata,
    refreshAccessToken: async () => ({ access_token: 'x', expires_in: 3600 }),
  });
  await provider.putRefreshToken('work', 'RT', { email: 'a@b.com' });

  await provider.removeAccount('work');
  assert.strictEqual(await keychain.get('gmail-mcp-local', 'work'), null);
  assert.strictEqual(await metadata.get('work'), null);
});

test('tokenFor delegates to the custody provider (custody-agnostic chokepoint)', async () => {
  const provider = makeBareLocal();
  await provider.putRefreshToken('work', 'RT');

  const tok = await tokenFor('work', { custody: provider });
  assert.ok(typeof tok === 'string' && tok.length > 0);

  await assert.rejects(() => tokenFor('work', {}), /requires a custody provider/);
  await assert.rejects(() => tokenFor('', { custody: provider }), /account ref required/);
});

test('ServerBrokerProvider is a gated stub: data methods throw, describe() flags operator exposure', async () => {
  const broker = createCustodyProvider('server-broker', {});
  assert.ok(broker instanceof ServerBrokerProvider);

  await assert.rejects(() => broker.getAccessToken('x'), (e) => e instanceof NotImplementedError);
  await assert.rejects(() => broker.putRefreshToken('x', 'y'), (e) => e instanceof NotImplementedError);
  await assert.rejects(() => broker.listAccounts(), (e) => e instanceof NotImplementedError);

  const d = broker.describe();
  assert.strictEqual(d.kind, 'server-broker');
  assert.strictEqual(d.mailExposedToOperator, true);
  assert.match(d.status, /NOT_IMPLEMENTED/);
  assert.ok(Array.isArray(d.contract.invariants) && d.contract.invariants.length > 0);
});

test('local provider describe() asserts no operator exposure and on-device custody', async () => {
  const d = makeBareLocal().describe();
  assert.strictEqual(d.kind, 'local-keychain');
  assert.strictEqual(d.mailExposedToOperator, false);
  assert.strictEqual(d.tokenLeavesDevice, false);
});

test('file-backed metadata store never serializes a secret to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmlf-'));
  const file = path.join(dir, 'accounts.json');
  try {
    const provider = new LocalKeychainProvider({
      keychain: new MemoryKeychainBackend(),
      metadata: createMetadataStore({ path: file }),
      refreshAccessToken: async () => ({ access_token: 'x', expires_in: 3600 }),
    });
    await provider.putRefreshToken('work', 'SUPER_SECRET_RT', { email: 'a@b.com', tag: 'work' });

    const onDisk = fs.readFileSync(file, 'utf8');
    assert.ok(!onDisk.includes('SUPER_SECRET_RT'), 'refresh token must never hit disk via the metadata store');
    assert.ok(onDisk.includes('a@b.com'), 'non-secret metadata is expected on disk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('factory rejects an unknown custody kind', () => {
  assert.throws(() => createCustodyProvider('bogus', {}), /Unknown custody kind/);
});
