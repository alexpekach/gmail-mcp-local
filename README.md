# gmail-mcp-local — local-first v1 (custody seam)

This package is the **local-first Gmail MCP v1** in progress: a runnable **stdio MCP server**
built on the **custody seam** and the **PKCE + loopback connect flow** that feeds it. It is a
**new, isolated** package — the working prototype under `../functions/gmail_mcp/` is
**untouched**. No deploy; tests run with zero native deps and never touch a live Google
endpoint or a browser (all I/O is injected).

## Why this exists (the seam)

In the prototype, `tokenFor()` (`functions/gmail_mcp/lib/tools.js:90`) is the single
chokepoint every one of the 19 Gmail tools routes through. It does two custody things:
resolve a refresh token and mint a short-lived access token — both hard-wired to the
Catalyst Data Store (`google.js:116`).

The seam hoists exactly those two concerns behind a `CustodyProvider` interface so the
tools become **custody-agnostic**. Swapping where keys live becomes a provider swap, not
a rewrite. This is what lets v1 ship **local-first** and grow into the deferred **Team
tier** without re-touching tool code (plan §1.H).

## What's here

```
src/
  custody/
    provider.js              CustodyProvider interface + error types
    localKeychainProvider.js  v1 — refresh token in the OS keychain, never leaves the device
    serverBrokerProvider.js   DEFERRED stub — gated on a funded Team customer (plan Part 1-D/§1.D.8)
    index.js                 createCustodyProvider(kind, config) factory
  keychain/
    backend.js               KeychainBackend interface
    memoryKeychainBackend.js  in-memory (tests / CI)
    osKeychainBackend.js      macOS Keychain / Windows Cred Manager / libsecret (optional native dep)
  metadata/
    store.js                 non-secret metadata; whitelists fields so a token CANNOT leak to disk
  oauth/
    pkce.js                  RFC 7636 PKCE pair + state (CSRF guard)
    google.js                buildAuthUrl / exchangeCodeForTokens / refreshAccessToken / userinfo (injectable HTTP)
    loopbackServer.js        ephemeral 127.0.0.1 redirect catcher (RFC 8252)
    openBrowser.js           default system-browser opener (injectable)
    connect.js               connectAccount() — orchestrates PKCE+loopback → custody.putRefreshToken()
  gmail/
    client.js                Gmail REST client (get/post/patch/del + grantedScopes; injectable HTTP)
    parse.js                 message header/body parsing (ported from the prototype)
    mime.js                  RFC 2822 message builder + reply-threading (ported from the prototype)
  mcp/
    server.js                JSON-RPC dispatch: initialize / tools/list / tools/call / ping
    transport.js             stdio transport — newline-delimited JSON-RPC (streams injectable)
    tools.js                 all 20 tools, each routed through tokenFor(ref, { custody })
  tokenFor.js                the custody-agnostic chokepoint
  index.js                   createGoogleLocalCustody() — convenience wiring (OS keychain + Google refresh)
bin/
  gmail-mcp-local.js         the stdio MCP server entrypoint (npm start)
test/
  custody · pkce · oauth · loopback · connect · mcp · transport · gmailtools · openbrowser · mime · client · tools-write   (67 tests)
```

## Connect flow (PKCE + loopback, public client)

```js
const { createGoogleLocalCustody } = require('./src');
const gc = createGoogleLocalCustody({ clientId: GOOGLE_DESKTOP_CLIENT_ID, metadataPath });
await gc.connect({ ref: 'work', tag: 'work' }); // opens browser → 127.0.0.1 redirect → keychain
const accessToken = await gc.token('work');      // minted from the keychain refresh token
```

PKCE protects against code interception. Google's **Desktop-app token endpoint nonetheless
requires the client secret** at the exchange (verified live 2026-06-08), so you must set
`GMAIL_MCP_CLIENT_SECRET`. That secret is **non-confidential**: an app-level value embedded in
the distributed client (Google's installed-app model) — *not* a per-user secret and *never*
stored on any server you operate. The loopback server binds 127.0.0.1 only.

## Custody models

| | LocalKeychainProvider (v1) | ServerBrokerProvider (deferred) |
|---|---|---|
| Refresh token lives | user's OS keychain | server-side vault |
| Operator can read mail | **No** (structural) | Yes (custodian) |
| Serves shared/offline mailboxes | No | Yes |
| Status | ships in v1 | stub — throws; built only when a Team customer funds it |

Native Gmail delegation was verified (2026-06-08) **not** to allow a delegate to access a
shared mailbox via their own local token, so concurrently-shared mailboxes require the
broker (or domain-wide delegation, which the plan rejects). See plan §1.H.

## Security invariants (enforced by tests)

- The refresh token is written **only** to the keychain backend, never to the metadata store.
- The metadata store **whitelists** fields, so even a buggy caller cannot persist a token to disk.
- `describe()` exposes each model's trust properties (`mailExposedToOperator`, `tokenLeavesDevice`).
- The broker stub **throws** on every data method — no server custody can sneak into v1.
- The connect flow sends the **PKCE verifier** plus the non-confidential desktop client secret
  Google's token endpoint requires; the loopback catcher **rejects state mismatches** (CSRF) and
  binds 127.0.0.1 only.

## Built so far

- Custody seam: `CustodyProvider` + `LocalKeychainProvider` + `ServerBrokerProvider` stub + `tokenFor`.
- PKCE + loopback connect flow storing a real Google refresh token into the keychain.
- **Runnable stdio MCP server** (JSON-RPC dispatch + transport) exposing **all 20 tools**, each
  routed through the seam — account mgmt (`list_accounts`/`connect_account`/`remove_account`/`set_tag`),
  read (`search_threads`/`get_thread`/`list_labels`/`list_thread_attachments`/`get_attachment`/`check_account_scopes`),
  write (`create_draft`/`send_draft`/`send_message`), modify (`label_thread`/`label_message`/`create_label`/`update_label`/`delete_label`/`trash_thread`/`untrash_thread`).
- **Verified live** (2026-06-08): connect → keychain → token refresh → real Gmail read against a live account.

## Not yet built (follow-on v1 work, behind Phase 0)

- Re-auth / scope-upgrade UX — the write/modify tools need a reconnect with `gmail.compose`/`gmail.modify`
  (a read-only-validated account can't send/label until reconnected with broader scopes).
- Desktop-client packaging/signing + publishing. See plan Part 1-L / Phase 1.
- Production use needs Google **restricted-scope verification + CASA** (cheapest no-backend tier) — the Phase-0 gate.

## Run as an MCP server (desktop clients)

Add to your client's MCP config (Claude Desktop / Cursor / VS Code):

```json
{
  "mcpServers": {
    "gmail-local": {
      "command": "node",
      "args": ["/abs/path/to/local-first/bin/gmail-mcp-local.js"],
      "env": { "GMAIL_MCP_CLIENT_ID": "<your-google-desktop-app-client-id>" }
    }
  }
}
```

Then in the client: `connect_account({ ref: "work" })` opens your browser; after consent the
refresh token lands in your OS keychain. `search_threads` / `get_thread` read mail — tokens and
mail never leave the machine. Real on-device custody needs a keychain module
(`npm i @napi-rs/keyring`) and a verified Google **Desktop-app** client id (Phase-0 gate). Set
`GMAIL_MCP_SCOPES` to narrow scopes (default: readonly + compose + modify).

**Full step-by-step → [SETUP_LIVE.md](./SETUP_LIVE.md)**: Google Cloud console setup + a
one-command live connect test (`node scripts/connect-test.js <ref> [tag]`) that connects a real
account and prints your latest threads — the Phase-0 go/no-go validation.

## Tests

```
cd local-first
npm test      # node --test — 67 tests, no native deps, no network, no browser
```
