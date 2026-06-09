#!/usr/bin/env node
'use strict';

/**
 * Wire the local-first server into desktop MCP clients (Claude Desktop / Cursor)
 * by adding an `mcpServers.gmail-local` entry that launches the stdio bin.
 *
 * - Only touches a client whose config DIRECTORY already exists (won't create a
 *   config for an app you don't have installed).
 * - Backs up any existing config to <file>.bak before writing.
 * - Additive merge — preserves your other MCP servers.
 * - No secret goes here: the bin reads ~/.gmail-mcp-local/config.json.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.resolve(__dirname, '..', 'bin', 'gmail-mcp-local.js');
const ENTRY = { command: 'node', args: [BIN] };

const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const targets = [
  { name: 'Claude Desktop', file: path.join(appdata, 'Claude', 'claude_desktop_config.json') },
  { name: 'Cursor', file: path.join(os.homedir(), '.cursor', 'mcp.json') },
];

const did = [];
for (const t of targets) {
  if (!fs.existsSync(path.dirname(t.file))) continue; // app not installed → skip
  let cfg = {};
  if (fs.existsSync(t.file)) {
    try { cfg = JSON.parse(fs.readFileSync(t.file, 'utf8')) || {}; }
    catch (e) { console.error(`skip ${t.name}: existing config is not valid JSON (${e.message})`); continue; }
    fs.copyFileSync(t.file, `${t.file}.bak`);
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  cfg.mcpServers['gmail-local'] = ENTRY;
  fs.writeFileSync(t.file, JSON.stringify(cfg, null, 2), 'utf8');
  did.push(`${t.name}: ${t.file}${fs.existsSync(`${t.file}.bak`) ? '  (backup: .bak)' : '  (created)'}`);
}

if (did.length) {
  console.log('Wired "gmail-local" into:\n - ' + did.join('\n - '));
  console.log('\nRestart the client app to load it. Then in-app: connect_account({ ref: "work" }).');
} else {
  console.log('No Claude Desktop / Cursor config directory found on this machine.');
  console.log('Add this to your MCP client config manually:\n');
  console.log(JSON.stringify({ mcpServers: { 'gmail-local': ENTRY } }, null, 2));
}
