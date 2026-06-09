# Packaging & publishing (end-user distribution)

How to ship the local-first connector so anyone can install it. This is **distribution**,
not server hosting — there is no server to deploy (hosting would re-introduce the
token honeypot the design avoids; see plan §1.H / Part 1-D).

## Hard precondition: Google verification
The app currently uses restricted Gmail scopes through **your** OAuth client in **Testing**
mode → capped at **100 hand-added test users**, with an "unverified app" screen and 7-day tokens.

To let *arbitrary* users connect, you must **Publish** the app, which triggers:
- **OAuth brand verification**, and
- **Restricted-scope verification + an annual CASA assessment** (gmail.readonly/compose/modify are restricted).

Local-first keeps this at the **cheapest, no-backend** CASA tier, but it is still weeks of
review + real cost. **Do not publish the npm package until this clears** — until then, onboard
people via [ONBOARDING-TESTER.md](./ONBOARDING-TESTER.md) (≤100 testers), which is enough to
validate demand.

## When verified — publish steps
1. **Embed your verified credentials:**
   `copy bundled-config.example.json bundled-config.json` and fill in your **verified**
   `clientId` + (non-confidential) desktop `clientSecret`. It ships inside the tarball via
   `package.json` → `files`. (Installed-app secrets aren't confidential; PKCE is the protection.)
2. **Finalize `package.json`:**
   - Set a real, available public `name` (e.g. `gmail-mcp-local`), bump `version`.
   - Set `"private": false`, a real `license`, and the `repository.url`.
3. **Inspect the tarball before publishing:**
   `npm pack --dry-run` — confirm `bundled-config.json`, `bin/`, `src/`, `scripts/` are IN and
   `test/` is OUT. (No `node_modules`, no `~/.gmail-mcp-local` state.)
4. **Publish:** `npm login` then `npm publish` (add `--access public` if the name is scoped).

## What the end user then does
1. `npx <name>` (or `npm i -g <name>`) — and `npm i @napi-rs/keyring` for the OS keychain.
2. `npm run setup` (wires `gmail-local` into Claude Desktop / Cursor) → restart the client.
3. In-app: `connect_account({ ref: "work" })` → consents through your **verified** app (no scary
   screen) → token in **their** keychain. Fully local.

## Do NOT
- **Host it** (a remote/SaaS connector) to make it usable in claude.ai web — that's the
  server-custody/broker tier (plan Part 1-D): tokens server-side, full CASA, SOC 2, operator-trust.
  Different, funded product. Decide deliberately, don't drift.
- **Ship per-user secrets** — the only embedded secret is the single, non-confidential desktop
  client secret. Refresh tokens are always per-user, in each user's OS keychain.
- **Publish pre-verification** — non-test-users will hit the unverified-app wall.

## Optional polish before public launch
- Add a `LICENSE` file (and a non-`UNLICENSED` license in package.json).
- Code-sign native installers if you ship those instead of npx.
- A short README "Privacy" section: mail + tokens never leave the device; you (operator) cannot read them.
