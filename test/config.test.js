'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, mergeConfig, parseScopes } = require('../src/config');

test('env wins over the config file', () => {
  const m = mergeConfig(
    { GMAIL_MCP_CLIENT_ID: 'ENV_ID', GMAIL_MCP_CLIENT_SECRET: 'ENV_SECRET' },
    { clientId: 'FILE_ID', clientSecret: 'FILE_SECRET' },
  );
  assert.strictEqual(m.clientId, 'ENV_ID');
  assert.strictEqual(m.clientSecret, 'ENV_SECRET');
});

test('file fills in when env is absent', () => {
  const m = mergeConfig({}, { clientId: 'FILE_ID', clientSecret: 'GOCSPX-real', scopes: ['a', 'b'] });
  assert.strictEqual(m.clientId, 'FILE_ID');
  assert.strictEqual(m.clientSecret, 'GOCSPX-real');
  assert.deepStrictEqual(m.scopes, ['a', 'b']);
});

test('a placeholder secret is treated as unset', () => {
  const m = mergeConfig({}, { clientId: 'X', clientSecret: 'PASTE_YOUR_GOCSPX_DESKTOP_SECRET_HERE' });
  assert.strictEqual(m.clientSecret, undefined);
});

test('scopes parse from a space/comma string or an array', () => {
  assert.deepStrictEqual(parseScopes('a b,c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(parseScopes(['x', 'y']), ['x', 'y']);
  assert.strictEqual(parseScopes(''), undefined);
  assert.strictEqual(parseScopes(undefined), undefined);
});

test('snake_case keys in the file are accepted', () => {
  const m = mergeConfig({}, { client_id: 'SID', client_secret: 'GOCSPX-x' });
  assert.strictEqual(m.clientId, 'SID');
  assert.strictEqual(m.clientSecret, 'GOCSPX-x');
});

test('loadConfig tolerates a UTF-8 BOM in the config file (PowerShell Set-Content)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const f = path.join(dir, 'config.json');
  try {
    fs.writeFileSync(f, '﻿' + JSON.stringify({ clientId: 'BID', clientSecret: 'GOCSPX-real' }));
    const c = loadConfig({ env: {}, configPath: f });
    assert.strictEqual(c.clientId, 'BID');
    assert.strictEqual(c.clientSecret, 'GOCSPX-real');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
