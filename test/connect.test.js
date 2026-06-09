'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { connectAccount } = require('../src/oauth/connect');
const { LocalKeychainProvider } = require('../src/custody');
const { MemoryKeychainBackend } = require('../src/keychain/memoryKeychainBackend');
const { createMetadataStore } = require('../src/metadata/store');
const { makeRefreshAccessToken } = require('../src/oauth/google');
const { tokenFor } = require('../src/tokenFor');

test('connectAccount: PKCE+loopback → stores refresh token via the seam → tokenFor mints access token', async () => {
  const keychain = new MemoryKeychainBackend();
  const metadata = createMetadataStore();

  // One fake Google token endpoint handling both grant types.
  const httpPost = async (url, form) => {
    if (form.grant_type === 'authorization_code') {
      assert.strictEqual(form.code, 'BROWSER_CODE');
      assert.ok(form.code_verifier.length >= 43, 'PKCE verifier must be sent');
      assert.ok(!('client_secret' in form), 'public client: no secret');
      return { access_token: 'AT_INITIAL', refresh_token: 'RT_LIVE', expires_in: 3600 };
    }
    if (form.grant_type === 'refresh_token') {
      assert.strictEqual(form.refresh_token, 'RT_LIVE');
      return { access_token: 'AT_REFRESHED', expires_in: 3600 };
    }
    throw new Error(`unexpected grant_type: ${form.grant_type}`);
  };

  const httpGet = async (url, headers) => {
    assert.match(headers.authorization, /^Bearer /);
    return { email: 'Owner@Example.com' };
  };

  // Fake browser: read the auth URL, fire the loopback redirect with a code.
  const openBrowser = async (url) => {
    const u = new URL(url);
    const redirectUri = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state');
    fetch(`${redirectUri}?code=BROWSER_CODE&state=${encodeURIComponent(state)}`).catch(() => {});
  };

  const provider = new LocalKeychainProvider({
    keychain,
    metadata,
    refreshAccessToken: makeRefreshAccessToken({ clientId: 'CID', httpPost }),
  });

  const res = await connectAccount({
    ref: 'work',
    tag: 'work',
    custody: provider,
    clientId: 'CID',
    scopes: ['openid', 'email'],
    openBrowser,
    httpPost,
    httpGet,
    timeoutMs: 5000,
  });

  assert.strictEqual(res.ref, 'work');
  assert.strictEqual(res.email, 'owner@example.com');

  // Refresh token is in the keychain — and never in metadata.
  assert.strictEqual(await keychain.get('gmail-mcp-local', 'work'), 'RT_LIVE');
  assert.ok(!metadata._serialize().includes('RT_LIVE'), 'refresh token must not be in metadata');

  // End-to-end through the seam: tokenFor mints an access token via refresh.
  const tok = await tokenFor('work', { custody: provider });
  assert.strictEqual(tok, 'AT_REFRESHED');
});

test('connectAccount validates clientId and custody before opening anything', async () => {
  await assert.rejects(
    () => connectAccount({ ref: 'r', custody: {}, openBrowser: async () => {} }),
    /clientId required/,
  );
  await assert.rejects(
    () => connectAccount({ ref: 'r', clientId: 'C' }),
    /custody provider required/,
  );
});
