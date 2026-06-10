'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseScopes(s) {
  if (!s) return undefined;
  if (Array.isArray(s)) { const l = s.filter(Boolean); return l.length ? l : undefined; }
  const l = String(s).split(/[\s,]+/).filter(Boolean);
  return l.length ? l : undefined;
}

/**
 * Merge env over a config object (env wins). Pure — unit-testable.
 * A placeholder secret (still containing "PASTE") is treated as unset, so an
 * un-filled scaffold produces a clear "missing secret" path rather than sending
 * "PASTE..." to Google.
 */
function mergeConfig(env = {}, file = {}) {
  let clientSecret = env.GMAIL_MCP_CLIENT_SECRET || file.clientSecret || file.client_secret || undefined;
  if (clientSecret && /paste/i.test(clientSecret)) clientSecret = undefined;
  return {
    clientId: env.GMAIL_MCP_CLIENT_ID || file.clientId || file.client_id || undefined,
    clientSecret,
    scopes: parseScopes(env.GMAIL_MCP_SCOPES) || parseScopes(file.scopes),
    licenseApiUrl: env.GMAIL_MCP_LICENSE_URL || file.licenseApiUrl || file.license_api_url || undefined,
    licenseKey: env.GMAIL_MCP_LICENSE_KEY || file.licenseKey || file.license_key || undefined,
    renewUrl: env.GMAIL_MCP_RENEW_URL || file.renewUrl || undefined,
    httpPort: env.GMAIL_MCP_HTTP_PORT || file.httpPort || undefined,
    httpSecret: env.GMAIL_MCP_HTTP_SECRET || file.httpSecret || undefined,
  };
}

function readJsonFile(p) {
  // Strip a leading UTF-8 BOM (e.g. from PowerShell's `Set-Content -Encoding utf8`)
  // before parsing — JSON.parse throws on a BOM otherwise.
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) || {}; } catch (_) { /* ignore */ }
  return {};
}

/**
 * Distributable defaults shipped WITH the package (lowest precedence). At publish
 * time, copy `bundled-config.example.json` → `bundled-config.json` and fill in
 * your VERIFIED Google client_id + (non-confidential) desktop client secret, so
 * end users connect without ever touching Google Cloud. Absent in dev → {}.
 */
function loadBundled() {
  return readJsonFile(path.join(__dirname, '..', 'bundled-config.json'));
}

/**
 * Resolve config with precedence: env  >  user file  >  bundled defaults.
 * User file default: ~/.gmail-mcp-local/config.json. This lets the desktop
 * secret live in ONE place (bundled for end users, or a local file for devs)
 * instead of being copied into every MCP client config.
 */
function loadConfig({ env = process.env, configPath } = {}) {
  const cp = configPath || env.GMAIL_MCP_CONFIG || path.join(os.homedir(), '.gmail-mcp-local', 'config.json');
  const file = { ...loadBundled(), ...readJsonFile(cp) }; // user file overrides bundled defaults
  const merged = mergeConfig(env, file);
  merged.metadataPath = env.GMAIL_MCP_METADATA || file.metadataPath || path.join(os.homedir(), '.gmail-mcp-local', 'accounts.json');
  merged.configPath = cp;
  return merged;
}

module.exports = { loadConfig, mergeConfig, parseScopes, readJsonFile };
