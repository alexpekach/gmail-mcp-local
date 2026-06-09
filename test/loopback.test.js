'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startLoopbackServer } = require('../src/oauth/loopbackServer');

test('loopback server resolves with the code on a matching-state redirect', async () => {
  const { redirectUri, waitForCode } = await startLoopbackServer({ expectedState: 'ST', timeoutMs: 5000 });
  const hit = fetch(`${redirectUri}?code=THECODE&state=ST`).catch(() => {});
  const result = await waitForCode();
  await hit;
  assert.strictEqual(result.code, 'THECODE');
});

test('loopback server rejects on state mismatch (CSRF guard)', async () => {
  const { redirectUri, waitForCode } = await startLoopbackServer({ expectedState: 'GOOD', timeoutMs: 5000 });
  const hit = fetch(`${redirectUri}?code=X&state=EVIL`).catch(() => {});
  await assert.rejects(() => waitForCode(), /state mismatch/);
  await hit;
});

test('loopback server rejects on an OAuth error param', async () => {
  const { redirectUri, waitForCode } = await startLoopbackServer({ expectedState: 'ST', timeoutMs: 5000 });
  const hit = fetch(`${redirectUri}?error=access_denied&state=ST`).catch(() => {});
  await assert.rejects(() => waitForCode(), /OAuth error: access_denied/);
  await hit;
});

test('binds to a 127.0.0.1 loopback redirect URI (not 0.0.0.0)', async () => {
  const { redirectUri, close } = await startLoopbackServer({ expectedState: 'ST', timeoutMs: 5000 });
  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/);
  close();
});
