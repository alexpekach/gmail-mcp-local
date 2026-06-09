# gmail-mcp-local

![local-first](https://img.shields.io/badge/local--first-yes-2ea44f)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-server-4b8bbe)
![tests](https://img.shields.io/badge/tests-82%20passing-2ea44f)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

**Your Gmail, inside Claude & Cursor — without handing your inbox to a server.**

A local-first [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Desktop, Cursor, VS Code, …) search, read, label, draft, and send your Gmail. Your Google login (OAuth refresh token) is stored in **your operating system's keychain** and **never leaves your machine** — there is no cloud service in the middle, not even ours.

## Why

- 🔒 **Private by design.** Mail and tokens stay on your device. There is no server that ever sees your email — so no operator (including us) *can* read it.
- 🧩 **Cross-client.** One install serves Claude Desktop, Cursor, VS Code, Windsurf.
- 📬 **Multi-account.** Connect personal + work Gmail, tag them, pick per request.
- 🛠️ **20 tools.** The full read/write/organize Gmail toolkit (below).

## Quick start

**Prereqs:** Node 20+, a desktop MCP client, and a Google **Desktop-app** OAuth client id + secret (free — 5-minute setup in [SETUP_LIVE.md](./SETUP_LIVE.md)).

```bash
npx github:alexpekach/gmail-mcp-local      # or grab the installer from Releases
npm i @napi-rs/keyring                     # OS keychain backend (one time)
```

Add to your MCP client config (Claude Desktop / Cursor):

```json
{
  "mcpServers": {
    "gmail-local": {
      "command": "node",
      "args": ["<path>/bin/gmail-mcp-local.js"],
      "env": {
        "GMAIL_MCP_CLIENT_ID": "<your-desktop-client-id>.apps.googleusercontent.com",
        "GMAIL_MCP_CLIENT_SECRET": "<non-confidential desktop secret>"
      }
    }
  }
}
```

Restart the client, then in chat:

```
connect_account({ ref: "work" })          # opens your browser; token lands in your keychain
search_threads({ account: "work", query: "newer_than:7d has:attachment" })
get_thread({ account: "work", thread_id: "…" })
```

Prefer a one-click setup? Download the installer from [Releases](https://github.com/alexpekach/gmail-mcp-local/releases) and double-click `install.cmd` (Windows) or `install.command` (macOS).

## What it can do (20 tools)

| Group | Tools |
|---|---|
| Accounts | `list_accounts` · `connect_account` · `remove_account` · `set_tag` |
| Read | `search_threads` · `get_thread` · `list_labels` · `list_thread_attachments` · `get_attachment` · `check_account_scopes` |
| Write | `create_draft` · `send_draft` · `send_message` |
| Organize | `label_thread` · `label_message` · `create_label` · `update_label` · `delete_label` · `trash_thread` · `untrash_thread` |

## Privacy & security

- **Tokens in the OS keychain** — macOS Keychain / Windows Credential Manager / Linux libsecret. Never written to disk in plaintext; never sent anywhere.
- **PKCE + loopback OAuth** (RFC 8252) — a public client; the auth code is exchanged with a one-time verifier, not a network-shared secret.
- **Local execution** — the server runs as a subprocess of your MCP client. No telemetry, no remote storage of mail or tokens.
- **Least scope** — request only the Gmail scopes you need (read-only by default).
- Restricted Gmail scopes mean your Google OAuth app must be **verified** (or in **Testing** with ≤100 users). See [SETUP_LIVE.md](./SETUP_LIVE.md).

## How it works (30 seconds)

Your client launches `gmail-mcp-local` as a local stdio subprocess → it runs Google OAuth in your browser → the refresh token is saved to your OS keychain → each tool call mints a short-lived access token and calls the Gmail API **directly from your machine**. A single `tokenFor()` chokepoint keeps every tool custody-agnostic, so the same code can later swap to a team/shared backend without touching tool logic.

## Develop

```bash
npm test     # 82 tests — no network, no browser, no native deps
```

CommonJS, Node ≥ 20. Issues and PRs welcome.

## Status

**v0.1.0** — local-first core (20 tools) complete and tested; verified live (read + draft) against real Gmail. Roadmap: re-auth/scope-upgrade UX, signed installers, optional Pro features (shared team mailboxes via a funded backend).

## License

[MIT](./LICENSE) © ALEPEK Accounting and Consulting LLC.
