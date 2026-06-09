# Onboard a tester (today — no verification needed, ≤100 users)

Use this to get a design partner running the local-first Gmail connector **before**
the app is Google-verified. Everything runs on *their* machine; their mail and tokens
never touch a server.

> **Why ≤100:** the Google app is in **Testing** mode. Only Google accounts you add
> as *test users* can connect (max 100), and they'll see an "unverified app" screen.
> That's enough to validate demand. Public launch needs verification + CASA — see PACKAGING.md.

---

## You (operator) — once per tester
1. Get the tester's **Google address** (the exact account they'll connect).
2. Google Cloud Console → **Google Auth Platform → Audience → Test users → + Add users** → add it → Save.
   (Skip this and they get `access_denied`.)

## Tester — install (~5 min)
**Prereqs:** Node 20+, a desktop MCP client (Claude Desktop / Cursor / VS Code).

1. **Get the package.**
   - Published: `npx @your-scope/gmail-mcp-local-setup` *(after PACKAGING.md is done)*, or
   - Pre-publish: clone/download the `local-first/` folder, then in it: `npm install`.
2. **Install the keychain module** (real on-device custody):
   `npm i @napi-rs/keyring`
3. **Credentials:** the package ships them (bundled). If you're on a pre-bundle build, the
   operator will give you a one-line `config.json` to drop at `~/.gmail-mcp-local/config.json`.
4. **Wire it into your client:** `npm run setup` → it adds `gmail-local` to your Claude
   Desktop / Cursor config (backs up the original). **Restart the client app.**

## Tester — connect & use
5. In the client chat: **`connect_account({ ref: "work" })`**.
   - Browser opens → sign in as the **test-user** account → **"Google hasn't verified this
     app" → Advanced → Go to … (unsafe)** → **Allow**. (The unverified screen is expected in Testing.)
6. Try it:
   - *"List my connected gmail accounts and show my 5 latest work threads."*
   - *"Label the threads from billing@ with a new label 'Bills' on my work account."*
   - *"Draft a one-line thank-you reply to the newest thread (don't send)."*

## Good to know
- **Testing mode = 7-day tokens.** If reads start failing after ~a week, just run
  `connect_account` again. (Verification removes this.)
- **Desktop only** — claude.ai web/mobile can't run a local server.
- **Local & private** — mail and the refresh token stay in the OS keychain on the tester's machine.
- **Uninstall:** `remove_account({ ref: "work" })`, revoke at <https://myaccount.google.com/permissions>,
  and delete the `gmail-local` entry from the client config (a `.bak` is next to it).

## If something breaks
- `No clientSecret` → the bundled creds aren't present; ask the operator for a `config.json`.
- `access_denied` → you weren't added as a test user (operator step 2).
- Tools don't appear → fully quit and reopen the client; confirm `node` is on PATH.
