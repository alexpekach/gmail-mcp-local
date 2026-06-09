'use strict';

/**
 * Google OAuth (native-app / public-client) + token helpers for local-first v1.
 *
 * Mirrors functions/gmail_mcp/lib/google.js but for the LOCAL flow:
 *   - PUBLIC client: no confidential client secret (PKCE is the protection).
 *   - All HTTP is injectable (httpPost / httpGet) so the module is unit-testable
 *     with zero live network calls.
 */

const DEFAULTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

// Mirrors the prototype's SCOPES. Least-scope is a Phase-0 decision (plan
// §1.L.6) — narrow this to the minimum the product actually needs.
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'email',
];

async function defaultHttpPost(url, form) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(`POST ${url} failed (${resp.status}): ${JSON.stringify(json)}`);
    e.status = resp.status; e.body = json; throw e;
  }
  return json;
}

async function defaultHttpGet(url, headers) {
  const resp = await fetch(url, { headers: headers || {} });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(`GET ${url} failed (${resp.status}): ${JSON.stringify(json)}`);
    e.status = resp.status; e.body = json; throw e;
  }
  return json;
}

function buildAuthUrl({ clientId, redirectUri, scopes = DEFAULT_SCOPES, codeChallenge, state, loginHint, authUrl = DEFAULTS.authUrl }) {
  if (!clientId) throw new Error('clientId required');
  if (!redirectUri) throw new Error('redirectUri required');
  if (!codeChallenge) throw new Error('codeChallenge required (PKCE)');
  if (!state) throw new Error('state required');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: Array.isArray(scopes) ? scopes.join(' ') : String(scopes),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${authUrl}?${params.toString()}`;
}

async function exchangeCodeForTokens({ clientId, clientSecret, code, codeVerifier, redirectUri, tokenUrl = DEFAULTS.tokenUrl, httpPost = defaultHttpPost, requireRefresh = true }) {
  if (!clientId) throw new Error('clientId required');
  if (!code) throw new Error('code required');
  if (!codeVerifier) throw new Error('codeVerifier required (PKCE)');
  if (!redirectUri) throw new Error('redirectUri required');
  const form = {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier, // PKCE proof — replaces the confidential secret
    client_id: clientId,
    redirect_uri: redirectUri,
  };
  // Installed/desktop apps are PUBLIC clients: any "secret" is non-confidential
  // and PKCE is the real protection. Default: omit it entirely.
  if (clientSecret) form.client_secret = clientSecret;
  const json = await httpPost(tokenUrl, form);
  if (requireRefresh && !json.refresh_token) {
    throw new Error('OAuth response had no refresh_token. Revoke the app at https://myaccount.google.com/permissions and retry (offline access requires fresh consent).');
  }
  return json;
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, tokenUrl = DEFAULTS.tokenUrl, httpPost = defaultHttpPost }) {
  if (!clientId) throw new Error('clientId required');
  if (!refreshToken) throw new Error('refreshToken required');
  const form = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId };
  if (clientSecret) form.client_secret = clientSecret;
  return httpPost(tokenUrl, form);
}

async function fetchUserInfo({ accessToken, userinfoUrl = DEFAULTS.userinfoUrl, httpGet = defaultHttpGet }) {
  if (!accessToken) throw new Error('accessToken required');
  return httpGet(userinfoUrl, { authorization: `Bearer ${accessToken}` });
}

/**
 * Returns the `refreshAccessToken(refreshToken) -> { access_token, expires_in }`
 * function shape that LocalKeychainProvider expects, with Google wired in.
 */
function makeRefreshAccessToken({ clientId, clientSecret, tokenUrl = DEFAULTS.tokenUrl, httpPost = defaultHttpPost }) {
  return (refreshToken) => refreshAccessToken({ clientId, clientSecret, refreshToken, tokenUrl, httpPost });
}

module.exports = {
  DEFAULTS,
  DEFAULT_SCOPES,
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchUserInfo,
  makeRefreshAccessToken,
  defaultHttpPost,
  defaultHttpGet,
};
