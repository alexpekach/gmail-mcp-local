'use strict';

const { CustodyProvider, AccountNotFoundError, TokenRefreshError } = require('./provider');

const DEFAULT_SERVICE = 'gmail-mcp-local';
const EXPIRY_SKEW_MS = 60_000; // re-mint if the cached token expires within this window

/**
 * Local-first custody: the Google refresh token lives in the OS keychain
 * (via the injected KeychainBackend) and NEVER leaves the device. Non-secret
 * metadata (email, tag, timestamps) lives in the injected MetadataStore.
 *
 * `refreshAccessToken(refreshToken) -> { access_token, expires_in }` is injected
 * so the seam carries no live-OAuth dependency and is fully unit-testable. In
 * the real app this is wired to Google's token endpoint (mirrors
 * functions/gmail_mcp/lib/google.js:refreshAccessToken).
 */
class LocalKeychainProvider extends CustodyProvider {
  constructor({ keychain, metadata, refreshAccessToken, now, service } = {}) {
    super();
    if (!keychain) throw new Error('LocalKeychainProvider requires a keychain backend');
    if (!metadata) throw new Error('LocalKeychainProvider requires a metadata store');
    if (typeof refreshAccessToken !== 'function') {
      throw new Error('LocalKeychainProvider requires a refreshAccessToken(refreshToken) function');
    }
    this.keychain = keychain;
    this.metadata = metadata;
    this.refreshAccessToken = refreshAccessToken;
    this.now = now || (() => Date.now());
    this.service = service || DEFAULT_SERVICE;
    this._cache = new Map(); // ref -> { access_token, expires_at_ms } (in-memory only)
  }

  async putRefreshToken(ref, refreshToken, meta = {}) {
    if (!ref) throw new Error('account ref required');
    if (!refreshToken) throw new Error('refreshToken required');
    // SECRET → keychain ONLY.
    await this.keychain.set(this.service, ref, refreshToken);
    const ts = new Date(this.now()).toISOString();
    // Non-secret metadata only. The store also whitelists fields defensively.
    await this.metadata.upsert(ref, {
      email: meta.email || null,
      tag: meta.tag || null,
      has_refresh_token: true,
      created_at: ts,
      last_used_at: ts,
    });
    this._cache.delete(ref);
    return { stored: true, ref };
  }

  async getAccessToken(ref) {
    if (!ref) throw new Error('account ref required');
    const now = this.now();
    const cached = this._cache.get(ref);
    if (cached && cached.expires_at_ms > now + EXPIRY_SKEW_MS) return cached.access_token;

    const refreshToken = await this.keychain.get(this.service, ref);
    if (!refreshToken) throw new AccountNotFoundError(ref);

    let tokens;
    try {
      tokens = await this.refreshAccessToken(refreshToken);
    } catch (e) {
      throw new TokenRefreshError(`Token refresh failed for "${ref}": ${e && e.message ? e.message : e}`);
    }
    if (!tokens || !tokens.access_token) {
      throw new TokenRefreshError(`Token refresh for "${ref}" returned no access_token`);
    }
    const expires_at_ms = now + (Number(tokens.expires_in || 3600) * 1000);
    this._cache.set(ref, { access_token: tokens.access_token, expires_at_ms });
    await this.metadata.touch(ref, new Date(now).toISOString()).catch(() => {});
    return tokens.access_token;
  }

  async removeAccount(ref) {
    await this.keychain.delete(this.service, ref).catch(() => {});
    await this.metadata.remove(ref).catch(() => {});
    this._cache.delete(ref);
    return { removed: true, ref };
  }

  async updateAccountMeta(ref, fields = {}) {
    if (!ref) throw new Error('account ref required');
    const existing = await this.metadata.get(ref);
    if (!existing) throw new AccountNotFoundError(ref);
    // metadata store whitelists fields, so this can never persist a secret.
    return this.metadata.upsert(ref, fields);
  }

  async listAccounts() {
    // Metadata only — never secrets.
    return this.metadata.list();
  }

  describe() {
    return {
      kind: 'local-keychain',
      custodian: 'end-user-device-os-keychain',
      mailExposedToOperator: false,
      tokenLeavesDevice: false,
      service: this.service,
    };
  }
}

module.exports = { LocalKeychainProvider, DEFAULT_SERVICE, EXPIRY_SKEW_MS };
