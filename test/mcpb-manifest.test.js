'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildManifest, firstSentence } = require('../scripts/build-mcpb');
const { buildTools } = require('../src/mcp/tools');

const PKG = { version: '0.1.0-seam', license: 'MIT', repository: { type: 'git', url: 'https://github.com/alexpekach/gmail-mcp-local.git' } };

test('public manifest has required mcpb 0.3 fields', () => {
  const m = buildManifest({ pkg: PKG, tools: buildTools(), turnkey: false });
  assert.strictEqual(m.manifest_version, '0.3');
  assert.strictEqual(m.name, 'gmail-mcp-local');
  assert.strictEqual(m.version, '0.1.0-seam');
  assert.ok(m.description.length > 0);
  assert.ok(m.author && m.author.name.length > 0);
  assert.strictEqual(m.server.type, 'node');
  assert.strictEqual(m.server.entry_point, 'bin/gmail-mcp-local.js');
  assert.ok(m.server.mcp_config.args[0].startsWith('${__dirname}/'));
});

test('public manifest wires user_config into env', () => {
  const m = buildManifest({ pkg: PKG, tools: buildTools(), turnkey: false });
  const env = m.server.mcp_config.env;
  assert.strictEqual(env.GMAIL_MCP_CLIENT_ID, '${user_config.client_id}');
  assert.strictEqual(env.GMAIL_MCP_CLIENT_SECRET, '${user_config.client_secret}');
  // every ${user_config.*} reference must exist in user_config
  for (const v of Object.values(env)) {
    const key = v.match(/^\$\{user_config\.(\w+)\}$/)[1];
    assert.ok(m.user_config[key], `user_config.${key} missing`);
  }
  assert.strictEqual(m.user_config.client_id.required, true);
  assert.strictEqual(m.user_config.client_secret.required, true);
  assert.strictEqual(m.user_config.client_secret.sensitive, true);
});

test('turnkey manifest has no user_config and no env', () => {
  const m = buildManifest({ pkg: PKG, tools: buildTools(), turnkey: true });
  assert.strictEqual(m.user_config, undefined);
  assert.strictEqual(m.server.mcp_config.env, undefined);
});

test('manifest tools mirror the registry', () => {
  const tools = buildTools();
  const m = buildManifest({ pkg: PKG, tools, turnkey: false });
  assert.strictEqual(m.tools.length, tools.length);
  for (const t of m.tools) {
    assert.ok(t.name.length > 0);
    assert.ok(t.description.length > 0, `${t.name} has empty description`);
  }
});

test('version override and repository placeholder handling', () => {
  const m = buildManifest({ pkg: PKG, tools: [], turnkey: false, version: '1.2.3' });
  assert.strictEqual(m.version, '1.2.3');
  assert.deepStrictEqual(m.repository, { type: 'git', url: PKG.repository.url });
  const m2 = buildManifest({ pkg: { version: '0.1.0', repository: { type: 'git', url: 'REPLACE_WITH_YOUR_REPO_URL' } }, tools: [], turnkey: false });
  assert.strictEqual(m2.repository, undefined);
});

test('manifest JSON round-trips cleanly', () => {
  const m = buildManifest({ pkg: PKG, tools: buildTools(), turnkey: false });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), m);
});

test('firstSentence trims at sentence boundary', () => {
  assert.strictEqual(firstSentence('One. Two.'), 'One.');
  assert.strictEqual(firstSentence('No terminator here'), 'No terminator here');
});
