/*
 * Wix Velo backend — paste into your site's  backend/http-functions.js
 * Exposes:  GET  https://<your-domain>/_functions/license?key=XXXX
 *           (preview/test URL uses /_functions-dev/license)
 *
 * Returns JSON the local MCP understands:
 *   { "valid": true,  "status": "ACTIVE", "until": "2026-12-31T..." }
 *   { "valid": false, "reason": "unknown_key" | "inactive" | "no_key" }
 *
 * UNVERIFIED ON WIX — paste, publish, then test the URL in a browser before shipping.
 * Requires a Wix Data collection named "Licenses" (schema in wix/SETUP-WIX.md),
 * kept up to date by backend/events.js.
 */
import { ok, badRequest, serverError } from 'wix-http-functions';
import wixData from 'wix-data';

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export async function get_license(request) {
  const key = ((request.query && request.query.key) || '').trim();
  if (!key) return badRequest({ headers: HEADERS, body: { valid: false, reason: 'no_key' } });

  try {
    const res = await wixData.query('Licenses').eq('key', key).limit(1).find({ suppressAuth: true });
    const lic = res.items[0];
    if (!lic) return ok({ headers: HEADERS, body: { valid: false, reason: 'unknown_key' } });

    const now = Date.now();
    const notExpired = !lic.expiresAt || new Date(lic.expiresAt).getTime() > now;
    const active = lic.status === 'ACTIVE' && notExpired;

    return ok({
      headers: HEADERS,
      body: {
        valid: !!active,
        status: lic.status || null,
        until: lic.expiresAt || null,
        reason: active ? undefined : 'inactive',
      },
    });
  } catch (e) {
    return serverError({ headers: HEADERS, body: { valid: false, reason: 'server_error' } });
  }
}
