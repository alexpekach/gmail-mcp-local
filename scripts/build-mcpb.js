#!/usr/bin/env node
'use strict';

/**
 * Build a Claude Desktop Extension (.mcpb) under dist/mcpb/.
 *
 * Layout produced:
 *   dist/mcpb/
 *     deps/        throwaway npm-install dir (pinned keychain packages)
 *     staging/     exactly what gets packed: manifest.json, bin/, src/,
 *                  package.json, docs, node_modules/ (keychain + 4 platform binaries)
 *     gmail-mcp-local-<version>[-turnkey].mcpb
 *
 * Flags:
 *   --bundle-creds   embed clientId/secret/scopes from ~/.gmail-mcp-local/config.json
 *                    (turnkey tester build; no user_config prompts in Claude Desktop)
 *   --skip-pack      stop after staging + manifest (offline; prints manual commands)
 *   --version X.Y.Z  override package.json version in the manifest
 *
 * The .mcpb spec requires all dependencies bundled inside the archive, so this
 * script installs @napi-rs/keyring plus its darwin/win32 native binaries (the
 * two platforms Claude Desktop runs on) into staging/node_modules.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readJsonFile } = require('../src/config');
const { buildTools } = require('../src/mcp/tools');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'mcpb');
const STAGE = path.join(OUT, 'staging');
const DEPS = path.join(OUT, 'deps');

// Keep inside the ^1.3.0 range declared in package.json optionalDependencies.
const KEYRING_VERSION = '1.3.0';
const PLATFORM_PKGS = [
  '@napi-rs/keyring-darwin-arm64',
  '@napi-rs/keyring-darwin-x64',
  '@napi-rs/keyring-win32-x64-msvc',
  '@napi-rs/keyring-win32-arm64-msvc',
];
const MCPB_CLI = '@anthropic-ai/mcpb@2';

function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

/** Pure manifest generator — unit-tested in test/mcpb-manifest.test.js. */
function buildManifest({ pkg, tools, turnkey, version }) {
  const m = {
    manifest_version: '0.3',
    name: 'gmail-mcp-local',
    display_name: 'Gmail (Local-First)',
    version: version || pkg.version,
    description: 'Local-first Gmail tools for Claude — OAuth tokens never leave your machine (stored in the OS keychain).',
    long_description:
      "Connect one or more Gmail accounts via Google's PKCE + loopback OAuth flow. " +
      'Refresh tokens are stored in the macOS Keychain / Windows Credential Manager and never leave your machine — ' +
      'no cloud service in the middle. 20 tools: search, read threads, attachments, drafts, send, and label management.',
    author: { name: 'ALEPEK Accounting and Consulting LLC' },
    license: pkg.license || 'MIT',
    keywords: ['gmail', 'mcp', 'local-first', 'oauth', 'email'],
    // icon: 'icon.png',  // optional in manifest 0.3 — add when we have one
    server: {
      type: 'node',
      entry_point: 'bin/gmail-mcp-local.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/bin/gmail-mcp-local.js'],
      },
    },
    compatibility: {
      platforms: ['darwin', 'win32'],
      runtimes: { node: '>=20.0.0' },
    },
    tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
  };
  const repoUrl = pkg.repository && pkg.repository.url;
  if (repoUrl && !/^REPLACE/.test(repoUrl)) m.repository = { type: 'git', url: repoUrl };
  if (!turnkey) {
    m.server.mcp_config.env = {
      GMAIL_MCP_CLIENT_ID: '${user_config.client_id}',
      GMAIL_MCP_CLIENT_SECRET: '${user_config.client_secret}',
    };
    m.user_config = {
      client_id: {
        type: 'string',
        title: 'Google OAuth Client ID',
        description:
          "Your Google Cloud OAuth 'Desktop app' client id (ends in .apps.googleusercontent.com). " +
          'See SETUP_LIVE.md in the repo for the 5-minute setup.',
        required: true,
      },
      client_secret: {
        type: 'string',
        title: 'Google OAuth Client Secret',
        description:
          "The matching desktop-app client secret (GOCSPX-…). Non-confidential under Google's installed-app model; " +
          'Claude Desktop stores it in your OS keychain.',
        sensitive: true,
        required: true,
      },
    };
  }
  return m;
}

function npm(args, cwd) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`npm ${args.join(' ')} failed (exit ${r.status})`);
    process.exit(1);
  }
}

function main() {
  const turnkey = process.argv.includes('--bundle-creds');
  const skipPack = process.argv.includes('--skip-pack');
  const vi = process.argv.indexOf('--version');
  const pkg = readJsonFile(path.join(ROOT, 'package.json'));

  // Clear staging + deps but keep previously built .mcpb files (so a turnkey
  // build doesn't delete the public artifact, and vice versa).
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.rmSync(DEPS, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  // --- app payload — deliberately NOT copying root bundled-config.json ---
  for (const item of ['bin', 'src', 'package.json', 'README.md', 'SETUP_LIVE.md', 'LICENSE']) {
    const s = path.join(ROOT, item);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(STAGE, item), { recursive: true });
  }

  // --- credentials ---
  if (turnkey) {
    const userCfgPath = process.env.GMAIL_MCP_CONFIG || path.join(os.homedir(), '.gmail-mcp-local', 'config.json');
    const uc = readJsonFile(userCfgPath);
    const clientId = uc.clientId || uc.client_id;
    const clientSecret = uc.clientSecret || uc.client_secret;
    if (!clientId || !clientSecret || /paste/i.test(String(clientSecret))) {
      console.error(`--bundle-creds: need a clientId + a real clientSecret in ${userCfgPath}`);
      process.exit(1);
    }
    const bundled = { clientId, clientSecret, scopes: uc.scopes || undefined };
    fs.writeFileSync(path.join(STAGE, 'bundled-config.json'), JSON.stringify(bundled, null, 2));
  } else if (fs.existsSync(path.join(STAGE, 'bundled-config.json'))) {
    console.error('public build must not contain bundled-config.json — aborting');
    process.exit(1);
  }

  // --- keychain dependency + native binaries for both Claude Desktop platforms ---
  // The platform packages declare os/cpu, so npm refuses the darwin ones on
  // Windows (EBADPLATFORM); naming them as DIRECT deps + --force installs them
  // anyway. --omit=optional suppresses @napi-rs/keyring's other 12 platform
  // optionals (linux/freebsd/ia32) that --force would otherwise pull in too.
  fs.mkdirSync(DEPS, { recursive: true });
  const deps = { '@napi-rs/keyring': KEYRING_VERSION };
  for (const p of PLATFORM_PKGS) deps[p] = KEYRING_VERSION;
  fs.writeFileSync(path.join(DEPS, 'package.json'), JSON.stringify({ name: 'mcpb-deps', private: true, dependencies: deps }, null, 2));
  npm(['install', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--force'], DEPS);
  fs.cpSync(path.join(DEPS, 'node_modules'), path.join(STAGE, 'node_modules'), { recursive: true });
  for (const p of PLATFORM_PKGS) {
    const d = path.join(STAGE, 'node_modules', p);
    const ok = fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.node'));
    if (!ok) {
      console.error(`missing native binary for ${p} — refusing to pack a broken extension`);
      process.exit(1);
    }
  }

  // --- manifest (written by Node → utf8, no BOM) ---
  const manifest = buildManifest({ pkg, tools: buildTools(), turnkey, version: vi > -1 ? process.argv[vi + 1] : undefined });
  fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // --- validate + pack ---
  const outFile = path.join(OUT, `gmail-mcp-local-${manifest.version}${turnkey ? '-turnkey' : ''}.mcpb`);
  if (skipPack) {
    console.log(`Staged: ${STAGE}`);
    console.log(`Skipped pack. Manual:\n  npx --yes ${MCPB_CLI} validate "${path.join(STAGE, 'manifest.json')}"\n  npx --yes ${MCPB_CLI} pack "${STAGE}" "${outFile}"`);
  } else {
    npm(['exec', '--yes', MCPB_CLI, '--', 'validate', path.join(STAGE, 'manifest.json')], ROOT);
    npm(['exec', '--yes', MCPB_CLI, '--', 'pack', STAGE, outFile], ROOT);
    console.log(`\nBuilt: ${outFile}`);
  }
  if (turnkey) console.log('TURNKEY: contains your (non-confidential) desktop client secret — share only with intended testers.');
}

module.exports = { buildManifest, firstSentence, KEYRING_VERSION, PLATFORM_PKGS };
if (require.main === module) main();
