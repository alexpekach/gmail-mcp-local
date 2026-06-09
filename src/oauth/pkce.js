'use strict';

const crypto = require('node:crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * RFC 7636 PKCE pair. The verifier is the secret kept in memory for the flow;
 * the challenge (S256) is what goes in the auth URL. This is what lets a PUBLIC
 * client (no client secret) prove possession at the token exchange.
 */
function generatePkce() {
  const code_verifier = base64url(crypto.randomBytes(32)); // 43 url-safe chars
  const code_challenge = base64url(crypto.createHash('sha256').update(code_verifier).digest());
  return { code_verifier, code_challenge, code_challenge_method: 'S256' };
}

/** CSRF/replay guard for the loopback round-trip. */
function generateState() {
  return base64url(crypto.randomBytes(24));
}

module.exports = { generatePkce, generateState, base64url };
