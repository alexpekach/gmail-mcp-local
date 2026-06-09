'use strict';

/**
 * The custody-agnostic chokepoint.
 *
 * Mirrors the prototype's tokenFor() (functions/gmail_mcp/lib/tools.js:90) but
 * delegates ALL custody to the injected provider. The 19 Gmail tools call this
 * and get a usable access token without knowing whether custody is local
 * (keychain, v1) or server (broker, deferred). Swapping custody models is a
 * provider swap — no tool changes. THIS is the seam.
 *
 * @param {string} ref - account reference (tag / label / email; one user per local install)
 * @param {{ custody: import('./custody').CustodyProvider }} deps
 * @returns {Promise<string>} Gmail access token
 */
async function tokenFor(ref, { custody } = {}) {
  if (!custody) throw new Error('tokenFor requires a custody provider (deps.custody)');
  if (!ref) throw new Error('account ref required');
  return custody.getAccessToken(ref);
}

module.exports = { tokenFor };
