'use strict';

const { generatePkce, generateState } = require('./pkce');
const { buildAuthUrl, exchangeCodeForTokens, fetchUserInfo, DEFAULT_SCOPES, DEFAULTS } = require('./google');
const { startLoopbackServer } = require('./loopbackServer');
const { openBrowser: defaultOpenBrowser } = require('./openBrowser');

/**
 * Local-first connect flow for ONE Google account, storing its refresh token via
 * the custody seam. PUBLIC client + PKCE + loopback redirect: no client secret,
 * nothing leaves the device, no server custody.
 *
 * Steps: generate PKCE+state -> start loopback catcher -> open browser to Google
 * -> receive code on 127.0.0.1 -> exchange (with PKCE verifier) -> resolve email
 * -> custody.putRefreshToken(). Returns { ref, email, tag, scopes }.
 *
 * All side-effecting parts (openBrowser/httpPost/httpGet) are injectable for tests.
 */
async function connectAccount({
  ref,
  tag,
  custody,
  clientId,
  clientSecret, // optional; omitted by default (installed apps are public clients)
  scopes = DEFAULT_SCOPES,
  loginHint,
  openBrowser = defaultOpenBrowser,
  onAuthUrl, // optional: called with the auth URL (manual copy-paste fallback)
  httpPost,
  httpGet,
  authUrl = DEFAULTS.authUrl,
  tokenUrl = DEFAULTS.tokenUrl,
  userinfoUrl = DEFAULTS.userinfoUrl,
  timeoutMs = 300_000,
} = {}) {
  if (!ref) throw new Error('ref required');
  if (!custody) throw new Error('custody provider required');
  if (!clientId) throw new Error('clientId required (Google OAuth Desktop-app client id)');

  const pkce = generatePkce();
  const state = generateState();

  const { redirectUri, waitForCode, close } = await startLoopbackServer({ expectedState: state, timeoutMs });
  try {
    const url = buildAuthUrl({ clientId, redirectUri, scopes, codeChallenge: pkce.code_challenge, state, loginHint, authUrl });
    if (typeof onAuthUrl === 'function') { try { onAuthUrl(url); } catch (_) { /* non-fatal */ } }
    await openBrowser(url);

    const { code } = await waitForCode();

    const tokens = await exchangeCodeForTokens({
      clientId, clientSecret, code, codeVerifier: pkce.code_verifier, redirectUri, tokenUrl, httpPost,
    });

    let email = null;
    try {
      if (tokens.access_token) {
        const info = await fetchUserInfo({ accessToken: tokens.access_token, userinfoUrl, httpGet });
        email = info && info.email ? String(info.email).toLowerCase() : null;
      }
    } catch (_) { /* email is best-effort metadata; never blocks the connect */ }

    await custody.putRefreshToken(ref, tokens.refresh_token, { email, tag: tag || null });
    return { ref, email, tag: tag || null, scopes };
  } finally {
    close();
  }
}

module.exports = { connectAccount };
