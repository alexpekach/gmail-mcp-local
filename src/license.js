'use strict';

const fs = require('node:fs');

const DAY = 86_400_000;

function defaultRead(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
function defaultWrite(p, o) { try { fs.writeFileSync(p, JSON.stringify(o), { encoding: 'utf8', mode: 0o600 }); } catch (_) { /* best effort */ } }

/**
 * License gate for the COMMERCIAL build. Validates a license key against the
 * hosted Velo endpoint (Wix). Behavior:
 *   - valid           -> ok, cache last-good timestamp to disk
 *   - definitely bad  -> NOT ok (expired / unknown key) — never graced
 *   - network/ambiguous error -> fail OPEN within `graceDays` of the last good
 *     check (so a transient Wix/network outage can't lock out a paying user),
 *     then fail CLOSED
 * In-memory cached for `checkIntervalMs` so we don't hit the endpoint per call.
 *
 * Disabled entirely when no apiUrl is configured (OSS / free build): the bin only
 * constructs a gate when `cfg.licenseApiUrl` is present, so open-source installs
 * are never gated.
 */
function createLicenseGate({
  apiUrl, key, statePath,
  fetchImpl, now, readState, writeState,
  graceDays = 7, checkIntervalMs = 3_600_000, timeoutMs = 8000,
  renewUrl,
} = {}) {
  if (!apiUrl) throw new Error('createLicenseGate requires apiUrl');
  const _now = now || (() => Date.now());
  const _fetch = fetchImpl || ((url, opts) => fetch(url, opts));
  const _read = readState || (statePath ? () => defaultRead(statePath) : () => null);
  const _write = writeState || (statePath ? (o) => defaultWrite(statePath, o) : () => {});
  const renew = renewUrl || 'your account page';
  let mem = null; // { ts, result }

  async function online() {
    const url = apiUrl + (apiUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key || '');
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const resp = await _fetch(url, ctrl ? { signal: ctrl.signal } : {});
      const json = await resp.json().catch(() => ({}));
      return { httpOk: resp.ok, json };
    } finally { if (t) clearTimeout(t); }
  }

  function grace(t) {
    const st = _read();
    if (st && st.lastOkMs && (t - st.lastOkMs) < graceDays * DAY) {
      const daysLeft = Math.ceil((graceDays * DAY - (t - st.lastOkMs)) / DAY);
      return { ok: true, grace: true, message: `License server unreachable; using cached license (~${daysLeft}d grace left).` };
    }
    return { ok: false, reason: 'unreachable_past_grace', message: `License server unreachable and offline grace expired. Reconnect to the internet, or renew at ${renew}.` };
  }

  async function check() {
    const t = _now();
    if (mem && (t - mem.ts) < checkIntervalMs) return mem.result;

    let result;
    if (!key) {
      result = { ok: false, reason: 'no_license_key', message: `No license key set. Add your key (manage/renew at ${renew}).` };
    } else {
      try {
        const { httpOk, json } = await online();
        if (httpOk && json && json.valid === true) {
          _write({ lastOkMs: t, until: json.until || null });
          result = { ok: true, status: json.status || 'active', until: json.until || null };
        } else if (httpOk && json && json.valid === false) {
          result = { ok: false, reason: json.reason || 'invalid', message: `License not active (${json.reason || 'invalid'}). Renew at ${renew}.` };
        } else {
          result = grace(t); // HTTP error / unparseable -> treat as transient
        }
      } catch (_) {
        result = grace(t); // network/timeout -> transient
      }
    }
    mem = { ts: t, result };
    return result;
  }

  return { check, _reset: () => { mem = null; } };
}

module.exports = { createLicenseGate };
