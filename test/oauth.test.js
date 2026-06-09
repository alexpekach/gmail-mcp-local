'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildAuthUrl, exchangeCodeForTokens, refreshAccessToken, makeRefreshAccessToken } = require('../src/oauth/google');

test('buildAuthUrl uses PKCE S256, offline access, and NO client secret', () => {
  const url = buildAuthUrl({
    clientId: 'CID',
    redirectUri: 'http://127.0.0.1:5000/oauth2/callback',
    codeChallenge: 'CHAL',
    state: 'ST',
    scopes: ['openid', 'email'],
  });
  const u = new URL(url);
  assert.strictEqual(u.searchParams.get('client_id'), 'CID');
  assert.strictEqual(u.searchParams.get('code_challenge'), 'CHAL');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5000/oauth2/callback');
  assert.strictEqual(u.searchParams.get('state'), 'ST');
  assert.strictEqual(u.searchParams.get('scope'), 'openid email');
  assert.ok(!u.searchParams.has('client_secret'));
});

test('buildAuthUrl validates required args', () => {
  assert.throws(() => buildAuthUrl({ redirectUri: 'x', codeChallenge: 'c', state: 's' }), /clientId required/);
  assert.throws(() => buildAuthUrl({ clientId: 'c', redirectUri: 'x', state: 's' }), /codeChallenge required/);
});

test('exchangeCodeForTokens sends the PKCE verifier and no secret by default', async () => {
  let captured = null;
  const httpPost = async (url, form) => { captured = { url, form }; return { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }; };
  const tokens = await exchangeCodeForTokens({ clientId: 'CID', code: 'CODE', codeVerifier: 'VER', redirectUri: 'RURI', httpPost });
  assert.strictEqual(tokens.refresh_token, 'RT');
  assert.strictEqual(captured.form.grant_type, 'authorization_code');
  assert.strictEqual(captured.form.code_verifier, 'VER');
  assert.strictEqual(captured.form.client_id, 'CID');
  assert.ok(!('client_secret' in captured.form), 'public client: no secret by default');
});

test('exchangeCodeForTokens throws when refresh_token is missing', async () => {
  const httpPost = async () => ({ access_token: 'AT', expires_in: 3600 }); // no refresh_token
  await assert.rejects(
    () => exchangeCodeForTokens({ clientId: 'CID', code: 'C', codeVerifier: 'V', redirectUri: 'R', httpPost }),
    /no refresh_token/,
  );
});

test('clientSecret is included only when explicitly provided', async () => {
  let captured = null;
  const httpPost = async (url, form) => { captured = form; return { access_token: 'AT', refresh_token: 'RT' }; };
  await exchangeCodeForTokens({ clientId: 'CID', clientSecret: 'SEC', code: 'C', codeVerifier: 'V', redirectUri: 'R', httpPost });
  assert.strictEqual(captured.client_secret, 'SEC');
});

test('refreshAccessToken posts grant_type=refresh_token without a secret', async () => {
  let captured = null;
  const httpPost = async (url, form) => { captured = form; return { access_token: 'AT2', expires_in: 3600 }; };
  const out = await refreshAccessToken({ clientId: 'CID', refreshToken: 'RT', httpPost });
  assert.strictEqual(out.access_token, 'AT2');
  assert.strictEqual(captured.grant_type, 'refresh_token');
  assert.strictEqual(captured.refresh_token, 'RT');
  assert.ok(!('client_secret' in captured));
});

test('makeRefreshAccessToken returns the provider-shaped refresh fn', async () => {
  const httpPost = async () => ({ access_token: 'AT3', expires_in: 1234 });
  const fn = makeRefreshAccessToken({ clientId: 'CID', httpPost });
  const out = await fn('RT');
  assert.strictEqual(out.access_token, 'AT3');
  assert.strictEqual(out.expires_in, 1234);
});
