# Wix commercial layer (Option 1 — all-Wix)

Sell the monthly subscription, deliver the installer, and validate licenses **entirely on
your existing Wix site**. The local app stays local-first — the only thing it calls home for
is a yes/no license check that carries **no mail and no tokens**.

> Reminder: Wix is **not** a Merchant of Record — you are responsible for VAT/sales-tax
> (automate calc with the Avalara app). If international sales grow, revisit routing billing
> through a MoR (Paddle/Lemon Squeezy) while keeping the rest of this on Wix.

## 1. Create the `Licenses` collection (Wix Data)
Content Manager → new collection **`Licenses`**, permissions **Admin-only** (no public read/write):

| Field | Type |
|---|---|
| `key` | Text (the license key) |
| `status` | Text (`ACTIVE` / `CANCELED` / `EXPIRED`) |
| `orderId` | Text |
| `planId` | Text |
| `memberId` | Text |
| `email` | Text |
| `expiresAt` | Date (empty = open-ended) |
| `createdAt` | Date |

## 2. Add the backend code (Velo / Dev Mode on)
- `backend/http-functions.js` ← paste `wix/backend/http-functions.js`
- `backend/events.js` ← paste `wix/backend/events.js` (**verify the Pricing-Plans event names/payloads for your API version** — see comments in the file)

## 3. Create the subscription product
- Dashboard → **Pricing Plans** → create a **recurring monthly** plan (your price).
- (Optional) **Wix Stores / Sell Downloads** → add the installer zip as a digital product so buyers get the download link on the Thank-You page + email.

## 4. Email the key on purchase
- Wix **Automations** → trigger "Pricing plan purchased" → send email. Include the license key
  (generated in `events.js`). If the Automation can't read the generated key, send the email
  from `events.js` via `wix-crm-backend` `triggeredEmails` instead.

## 5. Publish & get the endpoint URL
- Publish the site. Your license endpoint is:
  - **Live:** `https://<your-domain>/_functions/license`
  - **Preview/test:** `https://<your-domain>/_functions-dev/license`
- Test in a browser: `…/_functions/license?key=SOMEKEY` → expect JSON `{"valid":false,"reason":"unknown_key"}`; with a real key from the collection → `{"valid":true,...}`.

## 6. Wire it into the app
- **In the installer bundle** (`bundled-config.json`, same for everyone): set
  `"licenseApiUrl": "https://<your-domain>/_functions/license"`.
- **Per buyer:** they put their emailed key as `"licenseKey"` in `~/.gmail-mcp-local/config.json`
  (or set `GMAIL_MCP_LICENSE_KEY`). The server checks it on startup + hourly, with a 7-day
  offline grace window so a transient outage never locks out a paying user.
- With **no `licenseApiUrl`** configured (the OSS build), the gate is disabled → the app is free.

## What this does NOT do
- It is not hard DRM — a determined user can bypass a local license check. That's fine for a
  subscription product; don't over-invest in enforcement.
- It does not handle tax for you (see the MoR note above).
- Event names/payloads and emailing are the Wix-specific bits to **test in preview** before launch.
