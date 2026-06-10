# gmail-mcp-local

![local-first](https://img.shields.io/badge/local--first-yes-2ea44f)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-server-4b8bbe)
![tests](https://img.shields.io/badge/tests-89%20passing-2ea44f)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

**Your Gmail, inside Claude & Cursor — without handing your inbox to a server.**

A local-first [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Desktop, Cursor, VS Code, …) search, read, label, draft, and send your Gmail. Your Google login (OAuth refresh token) is stored in **your operating system's keychain** and **never leaves your machine** — there is no cloud service in the middle, not even ours.

## Why

- 🔒 **Private by design.** Mail and tokens stay on your device. There is no server that ever sees your email — so no operator (including us) *can* read it.
- 🧩 **Cross-client.** One install serves Claude Desktop, Cursor, VS Code, Windsurf.
- 📬 **Multi-account.** Connect personal + work Gmail, tag them, pick per request.
- 🛠️ **20 tools.** The full read/write/organize Gmail toolkit (below).

Using it is two separate steps — **install the connector once**, then **add Gmail accounts from inside the chat** whenever you like. You never have to hand-edit a config file (but you can — see the [appendix](#appendix-manual-install--whats-written-where)).

## 1 · Install the connector (once)

**One prerequisite for every path:** a Google **Desktop-app** OAuth client id + secret. It's free and takes ~5 minutes — full walkthrough in [SETUP_LIVE.md](./SETUP_LIVE.md). (Tester builds with credentials already bundled skip this entirely.)

### Option A — Claude Desktop extension (`.mcpb`) · easiest

1. Download `gmail-mcp-local-<version>.mcpb` from [Releases](https://github.com/alexpekach/gmail-mcp-local/releases).
2. In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…** and pick the file. (Double-clicking the `.mcpb` or dragging it into Claude Desktop may also work, but isn't reliable on every machine.)
3. Paste your Google client id + secret when prompted — Claude Desktop stores the secret in your **OS keychain**.

No terminal, no Node install, no config files. (Claude Desktop only; for Cursor use Option B.)

### Option B — One-click installer (Claude Desktop + Cursor)

1. Download `gmail-mcp-local-installer.zip` from [Releases](https://github.com/alexpekach/gmail-mcp-local/releases) and unzip.
2. Double-click `install.cmd` (Windows) or `install.command` (macOS). Requires [Node 20+](https://nodejs.org).
3. It copies the app to `~/.gmail-mcp-local/app` and **writes the MCP client config for you** — Claude Desktop and Cursor are auto-detected, your existing config is preserved (and backed up to `.bak`).
4. Unless your copy came with credentials bundled, put yours in `~/.gmail-mcp-local/config.json`:

```json
{ "clientId": "<your-id>.apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
```

### Option C — From source

```bash
git clone https://github.com/alexpekach/gmail-mcp-local.git
cd gmail-mcp-local
npm install          # pulls the OS keychain helper
npm run setup        # writes the Claude Desktop / Cursor config for you (same as Option B)
```

Credentials go in `~/.gmail-mcp-local/config.json` as in Option B (or env vars — see [appendix](#appendix-manual-install--whats-written-where)).

Then **fully quit and reopen** your MCP client. That's the last time you touch an installer.

## 2 · Add Gmail accounts (anytime, in chat)

Connecting accounts happens **in the conversation**, not in config files:

```
connect_account({ ref: "work" })
```

…your browser opens → sign in with Google → click Allow → done. The refresh token lands in your OS keychain; the account is ready immediately.

- **More accounts, anytime:** `connect_account({ ref: "personal", tag: "home" })` — connect as many as you like.
- **Pick per request:** every tool takes `account`, e.g. `search_threads({ account: "personal", query: "newer_than:7d has:attachment" })`.
- **See what's connected:** `list_accounts` (metadata only — never tokens).
- **Remove one:** `remove_account({ ref: "work" })` — deletes the token from your keychain.
- **Check granted scopes:** `check_account_scopes({ account: "work" })`.

## What it can do (20 tools)

| Group | Tools |
|---|---|
| Accounts | `list_accounts` · `connect_account` · `remove_account` · `set_tag` |
| Read | `search_threads` · `get_thread` · `list_labels` · `list_thread_attachments` · `get_attachment` · `check_account_scopes` |
| Write | `create_draft` · `send_draft` · `send_message` |
| Organize | `label_thread` · `label_message` · `create_label` · `update_label` · `delete_label` · `trash_thread` · `untrash_thread` |

## Privacy & security

- **Tokens in the OS keychain** — macOS Keychain / Windows Credential Manager / Linux libsecret. Never written to disk in plaintext; never sent anywhere. (The `.mcpb` extension keeps your client secret in the keychain too.)
- **PKCE + loopback OAuth** (RFC 8252) — a public client; the auth code is exchanged with a one-time verifier, not a network-shared secret.
- **Local execution** — the server runs as a subprocess of your MCP client. No telemetry, no remote storage of mail or tokens.
- **Least scope** — request only the Gmail scopes you need (read-only by default).
- Restricted Gmail scopes mean your Google OAuth app must be **verified** (or in **Testing** with ≤100 users). See [SETUP_LIVE.md](./SETUP_LIVE.md).

## How it works (30 seconds)

Your client launches `gmail-mcp-local` as a local stdio subprocess → it runs Google OAuth in your browser → the refresh token is saved to your OS keychain → each tool call mints a short-lived access token and calls the Gmail API **directly from your machine**. A single `tokenFor()` chokepoint keeps every tool custody-agnostic, so the same code can later swap to a team/shared backend without touching tool logic.

## Appendix: manual install & what's written where

You never *need* to hand-edit JSON — Options A–C above write everything for you. This section exists for transparency, and for clients the auto-setup doesn't cover (VS Code, Windsurf).

**What the installer / `npm run setup` writes** — one entry, added non-destructively to `%APPDATA%\Claude\claude_desktop_config.json` (Claude Desktop) and `~/.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "gmail-local": {
      "command": "node",
      "args": ["<install-path>/bin/gmail-mcp-local.js"]
    }
  }
}
```

For VS Code, Windsurf, or any other MCP client, add the same entry to that client's MCP config by hand.

**Where credentials come from** (precedence, highest first):

1. Env vars — `GMAIL_MCP_CLIENT_ID`, `GMAIL_MCP_CLIENT_SECRET` (set them in the `"env"` block of the entry above if you prefer everything in one file)
2. `~/.gmail-mcp-local/config.json` — `{ "clientId": "…", "clientSecret": "…" }`
3. `bundled-config.json` shipped inside the package (tester/turnkey builds)

Other knobs: `GMAIL_MCP_SCOPES` (override requested scopes), `GMAIL_MCP_CONFIG` (alternate config path), `GMAIL_MCP_METADATA` (alternate accounts metadata path).

**Uninstall:** `remove_account({ ref: "…" })` for each account → delete `~/.gmail-mcp-local` → remove the `gmail-local` entry from your client config (a `.bak` backup sits next to it) → revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Develop

```bash
npm test             # 89 tests — no network, no browser, no native deps
npm run build:mcpb   # build the Claude Desktop extension → dist/mcpb/*.mcpb
```

CommonJS, Node ≥ 20. Issues and PRs welcome.

## Status

**v0.1.0** — local-first core (20 tools) complete and tested; verified live (read + draft) against real Gmail; ships as a one-click installer **and** a Claude Desktop extension (`.mcpb`). Roadmap: re-auth/scope-upgrade UX, signed installers, optional Pro features (shared team mailboxes via a funded backend).

## License

[MIT](./LICENSE) © ALEPEK Accounting and Consulting LLC.
