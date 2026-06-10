#!/usr/bin/env node
'use strict';

/**
 * Assemble a download-and-run installer bundle under dist/.
 *
 * Layout produced:
 *   dist/gmail-mcp-local-installer/
 *     install.cmd          (Windows — double-click)
 *     install.command      (macOS/Linux — double-click)
 *     README.txt           (end-user instructions)
 *     app/                 (the package: bin, src, scripts, package.json, creds, docs)
 *
 * Zip the folder and send it. The installer requires Node.js on the target
 * machine (it detects it and points to nodejs.org if missing). A fully
 * self-contained, signed native installer is a separate build — see PACKAGING.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonFile } = require('../src/config');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'gmail-mcp-local-installer');
const APP = path.join(OUT, 'app');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// --- app payload (no node_modules / test / dist) ---
const appItems = ['bin', 'src', 'scripts', 'package.json', 'README.md', 'SETUP_LIVE.md'];
for (const item of appItems) {
  const s = path.join(ROOT, item);
  if (fs.existsSync(s)) fs.cpSync(s, path.join(APP, item), { recursive: true });
}

// --- credentials ---
// --bundle-creds : embed clientId/secret/scopes from your local config so the zip
//                  is turnkey (the desktop secret is non-confidential / app-embedded).
let credNote;
const bundleFromConfig = process.argv.includes('--bundle-creds');
if (bundleFromConfig) {
  const userCfgPath = process.env.GMAIL_MCP_CONFIG || path.join(os.homedir(), '.gmail-mcp-local', 'config.json');
  const uc = readJsonFile(userCfgPath);
  const clientId = uc.clientId || uc.client_id;
  const clientSecret = uc.clientSecret || uc.client_secret;
  if (!clientId || !clientSecret || /paste/i.test(String(clientSecret))) {
    console.error(`--bundle-creds: need a clientId + a real clientSecret in ${userCfgPath}`);
    process.exit(1);
  }
  const bundled = { clientId, clientSecret, scopes: uc.scopes || undefined };
  fs.writeFileSync(path.join(APP, 'bundled-config.json'), JSON.stringify(bundled, null, 2));
  credNote = `bundled-config.json EMBEDDED from ${userCfgPath} — TURNKEY. The zip now contains your (non-confidential) desktop client secret; share only with intended testers.`;
} else if (fs.existsSync(path.join(ROOT, 'bundled-config.json'))) {
  fs.cpSync(path.join(ROOT, 'bundled-config.json'), path.join(APP, 'bundled-config.json'));
  credNote = 'bundled-config.json INCLUDED — installer is self-contained (turnkey).';
} else {
  fs.cpSync(path.join(ROOT, 'bundled-config.example.json'), path.join(APP, 'bundled-config.example.json'));
  credNote = 'NOT turnkey: no creds embedded. Re-run with  --bundle-creds  to embed creds from ~/.gmail-mcp-local/config.json.';
}

// --- installer scripts at the bundle root ---
for (const f of ['install.cmd', 'install.command', 'README.txt']) {
  fs.cpSync(path.join(ROOT, 'installer', f), path.join(OUT, f));
}
// best-effort executable bit for the mac script (preserved if zipped on a unix host)
try { fs.chmodSync(path.join(OUT, 'install.command'), 0o755); } catch (_) { /* windows: ignored */ }

console.log('Built installer bundle:');
console.log('  ' + OUT);
console.log('  ' + credNote);
console.log('\nNext: zip the folder and send it. Windows -> install.cmd, macOS -> install.command.');
