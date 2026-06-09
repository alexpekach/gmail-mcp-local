#!/usr/bin/env node
'use strict';

/**
 * SAFE live WRITE test (dev tool — NOT part of the test suite).
 *
 * Reconnects an account with the `gmail.compose` scope, then creates a DRAFT
 * addressed to yourself. It does NOT send anything. Proves the write path
 * (compose → MIME → POST /drafts) end-to-end against live Gmail.
 *
 * Reads config from env or ~/.gmail-mcp-local/config.json (clientId + clientSecret).
 *
 * Usage:  node scripts/draft-test.js [ref] [tag]      (default ref "work")
 */

const path = require('node:path');
const fs = require('node:fs');

const { loadConfig } = require('../src/config');
const { createGoogleLocalCustody } = require('../src');
const { createGmailClient } = require('../src/gmail/client');
const { buildTools } = require('../src/mcp/tools');

async function main() {
  const cfg = loadConfig();
  if (!cfg.clientId) { console.error(`No clientId — set GMAIL_MCP_CLIENT_ID or add "clientId" to ${cfg.configPath}`); process.exit(1); }
  if (!cfg.clientSecret) { console.error(`No clientSecret — add your (non-confidential) desktop "clientSecret" to ${cfg.configPath}`); process.exit(1); }

  const ref = process.argv[2] || 'work';
  const tag = process.argv[3] || 'personal';
  // Need gmail.compose to create a draft; keep readonly so reads still work.
  const hasCompose = cfg.scopes && cfg.scopes.some((s) => s.includes('gmail.compose'));
  const scopes = hasCompose ? cfg.scopes : ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'];

  fs.mkdirSync(path.dirname(cfg.metadataPath), { recursive: true });
  const gc = createGoogleLocalCustody({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, metadataPath: cfg.metadataPath, scopes });

  console.error(`\n[1/2] Reconnecting "${ref}" with compose scope (browser opens; NOTHING is sent)…`);
  const acct = await gc.connect({ ref, tag, onAuthUrl: (u) => console.error(`\nIf your browser did not open, paste this URL:\n\n${u}\n`) });
  console.error(`[1/2] Connected: ${acct.email}`);

  console.error('[2/2] Creating a DRAFT addressed to yourself (no send)…');
  const token = await gc.token(ref);
  const gmail = createGmailClient();
  const createDraft = buildTools().find((t) => t.name === 'create_draft');
  const res = await createDraft.handler({
    account: ref,
    to: [acct.email],
    subject: 'gmail-mcp-local write test (draft only)',
    body: 'This draft was created by the local-first Gmail MCP write-path test. Nothing was sent. Safe to delete.',
  }, { custody: gc.provider, gmail });

  console.log(JSON.stringify({ account: acct.email, draft: res }, null, 2));
  console.error('\nDone. Open Gmail → Drafts to see it (subject "gmail-mcp-local write test"). Delete it anytime. NOTHING was sent.');
}

main().catch((e) => { console.error('\nFAILED:', e && e.message ? e.message : e); process.exitCode = 1; });
