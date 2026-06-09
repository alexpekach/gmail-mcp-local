#!/usr/bin/env node
'use strict';

/**
 * One-shot LIVE connect test (dev tool — NOT part of the test suite).
 *
 * Opens your browser, runs the PKCE + loopback OAuth flow for one account,
 * stores the refresh token in your OS keychain, then proves read access by
 * listing your latest threads. Nothing leaves your machine.
 *
 * Requires: a Google **Desktop-app** client id + a keychain module
 *   npm i @napi-rs/keyring
 *
 * Usage (PowerShell):
 *   $env:GMAIL_MCP_CLIENT_ID="...apps.googleusercontent.com"
 *   node scripts/connect-test.js work personal
 *
 * Optional env: GMAIL_MCP_CLIENT_SECRET, GMAIL_MCP_SCOPES, GMAIL_MCP_METADATA
 *
 * Progress goes to stderr; the final JSON result goes to stdout.
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { createGoogleLocalCustody } = require('../src');
const { createGmailClient } = require('../src/gmail/client');

function parseScopes(s) {
  if (!s) return undefined;
  const list = String(s).split(/[\s,]+/).filter(Boolean);
  return list.length ? list : undefined;
}

async function main() {
  const clientId = process.env.GMAIL_MCP_CLIENT_ID;
  if (!clientId) {
    console.error('Set GMAIL_MCP_CLIENT_ID (Google OAuth Desktop-app client id).');
    process.exit(1);
  }
  const clientSecret = process.env.GMAIL_MCP_CLIENT_SECRET || undefined;
  const ref = process.argv[2] || 'test';
  const tag = process.argv[3] || 'test';
  // Default to read-only least scope for the validation run.
  const scopes = parseScopes(process.env.GMAIL_MCP_SCOPES) || ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'];
  const metadataPath = process.env.GMAIL_MCP_METADATA || path.join(os.homedir(), '.gmail-mcp-local', 'accounts.json');
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });

  const gc = createGoogleLocalCustody({ clientId, clientSecret, metadataPath, scopes });

  console.error(`\n[1/3] Opening your browser to connect "${ref}" (scopes: ${scopes.join(' ')})…`);
  const acct = await gc.connect({
    ref,
    tag,
    onAuthUrl: (u) => console.error(`\nIf your browser did not open (or showed an error), paste this URL into a browser signed in as your test user:\n\n${u}\n`),
  });
  console.error(`[1/3] Connected: ${acct.email || '(email scope not granted)'} — refresh token stored in OS keychain.`);

  console.error('[2/3] Minting an access token from the keychain refresh token…');
  const token = await gc.token(ref);
  console.error('[2/3] OK — refresh path works.');

  console.error('[3/3] Reading your latest 5 threads (proves read access)…');
  const gmail = createGmailClient();
  const data = await gmail.get(token, '/users/me/threads', { maxResults: 5 });
  const threads = (data.threads || []).map((t) => ({ id: t.id, snippet: (t.snippet || '').slice(0, 80) }));

  console.log(JSON.stringify({ account: acct, threads }, null, 2));
  console.error('\nDone. To disconnect: remove the keychain entry and revoke at https://myaccount.google.com/permissions');
}

main().catch((e) => {
  console.error('\nFAILED:', e && e.message ? e.message : e);
  // Set exit code and let the loop drain (avoids forcing exit while the loopback
  // server handle is still closing — which can trigger a libuv assertion on Windows).
  process.exitCode = 1;
});
