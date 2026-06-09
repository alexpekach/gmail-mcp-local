# Live setup — wiring the local-first server to real Google

This is the Phase-0 validation: prove the whole local-first loop (connect → keychain →
read) works against **live** Gmail with **one** account, before investing in the remaining
tools. Everything here is on your machine — no server, no deploy. ~15 minutes.

> **Why this matters:** it's the go/no-go signal. If a real account connects and reads
> through the keychain with no server custody, the local-first thesis (plan §1.H) is proven.

---

## 0. Prerequisites
- Node ≥ 20 (you have 24).
- A Google account to test with.
- In `local-first/`, install a keychain module (only needed for *real* on-device custody;
  tests don't need it):
  ```
  npm i @napi-rs/keyring
  ```

## 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com> → create or select a project.
2. **APIs & Services → Library → Gmail API → Enable.**

## 2. Configure the OAuth consent screen
**APIs & Services → OAuth consent screen:**
- **User type:** External (or *Internal* if this is a Workspace org and you only need your own domain).
- App name, user-support email, developer email.
- **Scopes:** add what you'll request. For this validation, least-scope = **`.../auth/gmail.readonly`** (plus `openid`, `email`). These are *restricted* scopes.
- **Test users:** add the Google account(s) you'll test with (up to 100). Leave publishing status = **Testing**.

> ⚠️ **Two caveats that bite later, not now:**
> 1. In **Testing** status, **refresh tokens expire after 7 days.** Fine for validation; for real use you must **Publish**, which triggers **restricted-scope verification + annual CASA** — the Phase-0 gate in the plan (§1.L.6 / Part 4). Local-first makes that the *cheapest* CASA tier, but it is **not** zero.
> 2. Test users will see a **"Google hasn't verified this app"** screen → **Advanced → Go to … (unsafe)**. Normal for Testing.

## 3. Create the OAuth client (Desktop app)
**APIs & Services → Credentials → Create credentials → OAuth client ID:**
- **Application type: Desktop app.** (This is the key choice — Desktop clients are *public clients* and Google auto-allows the `http://127.0.0.1` loopback redirect, so you do **not** register redirect URIs.)
- Name it, create, and **copy the Client ID** (e.g. `1234-abc.apps.googleusercontent.com`).
- A client *secret* is also shown — **copy it too.** Google's Desktop-app token endpoint **requires** it at the exchange (verified live), even with PKCE. It is **non-confidential** (an app-embedded value, not a per-user secret, never stored on a server you run) — PKCE is still the real protection against code interception. You'll set it as `GMAIL_MCP_CLIENT_SECRET` in step 4.

## 4. Run the one-command connect test
From `local-first/` (PowerShell):
```powershell
$env:GMAIL_MCP_CLIENT_ID = "1234-abc.apps.googleusercontent.com"
# REQUIRED for Desktop-app clients — Google's token endpoint demands it, even with PKCE:
$env:GMAIL_MCP_CLIENT_SECRET = "GOCSPX-..."
# optional, override scopes (default is read-only + openid + email):
# $env:GMAIL_MCP_SCOPES = "https://www.googleapis.com/auth/gmail.readonly openid email"

node scripts/connect-test.js work personal
```
What happens:
1. Your browser opens to Google → sign in as a **test user** → (pass the unverified-app screen) → **Allow**.
2. The redirect hits `http://127.0.0.1:<port>` — the page says "Connected."
3. The refresh token is stored in your **OS keychain**; the script mints an access token and prints your latest 5 thread snippets as JSON.

**Success = you see your thread snippets.** That's the full local-first loop proven against live Google.

## 5. Wire it into a desktop MCP client (optional)
Add to Claude Desktop / Cursor / VS Code MCP config:
```json
{
  "mcpServers": {
    "gmail-local": {
      "command": "node",
      "args": ["C:/Users/alexp/Claude/Projects/Palmcraft/gmail-mcp/local-first/bin/gmail-mcp-local.js"],
      "env": {
        "GMAIL_MCP_CLIENT_ID": "1234-abc.apps.googleusercontent.com",
        "GMAIL_MCP_SCOPES": "https://www.googleapis.com/auth/gmail.readonly openid email"
      }
    }
  }
}
```
Then in the client: `connect_account({ ref: "work" })`, then `search_threads` / `get_thread`.

## 6. Clean up a test connection
- In a client: `remove_account({ ref: "work" })` (deletes the keychain entry + metadata).
- Revoke the app's access at <https://myaccount.google.com/permissions>.

---

## Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| `No OS keychain module found` | `npm i @napi-rs/keyring` in `local-first/`. |
| `OAuth response had no refresh_token` | You'd previously consented; revoke at myaccount.google.com/permissions and retry (the flow forces `prompt=consent`, so this is rare). |
| `access_denied` / unverified screen blocks you | Add your account under **Test users**; click **Advanced → Go to … (unsafe)**. |
| Read works for ~a week then refresh fails | Expected in **Testing** status (7-day refresh-token expiry). Re-run connect, or publish + verify for real use. |
| Token exchange rejects PKCE-only | Set `GMAIL_MCP_CLIENT_SECRET` to the (non-confidential) desktop secret. |

## What this does NOT do
- It does **not** publish/verify your app (restricted-scope verification + CASA is the Phase-0 gate).
- It does **not** grant write/label scopes by default (read-only validation). Add
  `gmail.compose` / `gmail.modify` to `GMAIL_MCP_SCOPES` when the write tools are ported.
- It does **not** give you shared/concurrent mailbox access — that needs the deferred broker
  tier (native Gmail delegation was verified not to work; plan §1.H).
