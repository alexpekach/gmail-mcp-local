#!/usr/bin/env node
'use strict';

/**
 * Local-first Gmail MCP server (stdio). A desktop MCP client (Claude Desktop,
 * Cursor, VS Code, …) launches this as a subprocess. Everything stays on the
 * machine: refresh tokens in the OS keychain, no server custody.
 *
 * Config resolves from env first, then ~/.gmail-mcp-local/config.json:
 *   clientId        (required) Google OAuth *Desktop app* client id
 *   clientSecret    (required for Google desktop clients; non-confidential, app-embedded)
 *   scopes          (optional) array or space/comma string (default: readonly+compose+modify)
 *   metadataPath    (optional) accounts metadata json
 * Env equivalents: GMAIL_MCP_CLIENT_ID / _CLIENT_SECRET / _SCOPES / _METADATA / _CONFIG.
 *
 * stdout is the MCP protocol channel — logs go to stderr only.
 */

const path = require('node:path');
const fs = require('node:fs');

const { loadConfig } = require('../src/config');
const { createGoogleLocalCustody } = require('../src');
const { createGmailClient } = require('../src/gmail/client');
const { buildTools } = require('../src/mcp/tools');
const { createMcpServer } = require('../src/mcp/server');
const { runStdioServer } = require('../src/mcp/transport');

const pkg = require('../package.json');

function main() {
  const cfg = loadConfig();
  if (!cfg.clientId) {
    process.stderr.write(`[gmail-mcp-local] FATAL: no clientId. Set GMAIL_MCP_CLIENT_ID or add "clientId" to ${cfg.configPath}\n`);
    process.exit(1);
  }
  if (!cfg.clientSecret) {
    process.stderr.write(`[gmail-mcp-local] WARN: no clientSecret — connecting a Google Desktop client will fail. Add "clientSecret" to ${cfg.configPath}\n`);
  }
  fs.mkdirSync(path.dirname(cfg.metadataPath), { recursive: true });

  const gc = createGoogleLocalCustody({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, metadataPath: cfg.metadataPath, scopes: cfg.scopes });
  const gmail = createGmailClient();
  const tools = buildTools();

  // Commercial license gate — active only when a license endpoint is configured.
  // OSS / free builds have no licenseApiUrl, so the gate stays off entirely.
  let licenseGate = null;
  if (cfg.licenseApiUrl) {
    const { createLicenseGate } = require('../src/license');
    licenseGate = createLicenseGate({
      apiUrl: cfg.licenseApiUrl,
      key: cfg.licenseKey,
      statePath: path.join(path.dirname(cfg.metadataPath), 'license.json'),
      renewUrl: cfg.renewUrl,
    });
    process.stderr.write(`[gmail-mcp-local] license gate ON${cfg.licenseKey ? '' : ' — WARN: no licenseKey set'}\n`);
  }

  const deps = { custody: gc.provider, connect: gc.connect, gmail, licenseGate };
  const server = createMcpServer({ tools, deps, serverInfo: { name: 'gmail-mcp-local', version: pkg.version } });

  process.stderr.write(`[gmail-mcp-local] stdio server ready (v${pkg.version}); ${tools.length} tools; metadata=${cfg.metadataPath}\n`);
  runStdioServer({ server }).then(() => process.exit(0));
}

main();
