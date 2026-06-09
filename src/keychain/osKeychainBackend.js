'use strict';

const { KeychainBackend } = require('./backend');

/**
 * OS keychain backend. Lazy-loads an OPTIONAL native module:
 *   1) @napi-rs/keyring  (maintained; preferred)
 *   2) keytar            (legacy fallback)
 *
 * Neither is required for the seam or its tests (those use MemoryKeychainBackend).
 * Install one for real on-device custody:  npm i @napi-rs/keyring
 *
 * Secrets are stored in: macOS Keychain, Windows Credential Manager (DPAPI),
 * or libsecret on Linux — encrypted at rest and access-controlled per user/app.
 */
class OsKeychainBackend extends KeychainBackend {
  constructor() {
    super();
    this._impl = null;
    this._kind = null;
  }

  _load() {
    if (this._impl) return this._impl;

    // Preferred: @napi-rs/keyring (maintained).
    try {
      const { Entry } = require('@napi-rs/keyring');
      this._kind = 'napi-keyring';
      this._impl = {
        set: (svc, acct, secret) => { new Entry(svc, acct).setPassword(secret); },
        get: (svc, acct) => { try { return new Entry(svc, acct).getPassword(); } catch (_) { return null; } },
        delete: (svc, acct) => { try { new Entry(svc, acct).deletePassword(); } catch (_) { /* already gone */ } },
        list: null, // no enumerate API → metadata store is the listing source of truth
      };
      return this._impl;
    } catch (_) { /* try next */ }

    // Fallback: keytar (archived but widely deployed).
    try {
      const keytar = require('keytar');
      this._kind = 'keytar';
      this._impl = {
        set: (svc, acct, secret) => keytar.setPassword(svc, acct, secret),
        get: (svc, acct) => keytar.getPassword(svc, acct),
        delete: (svc, acct) => keytar.deletePassword(svc, acct),
        list: (svc) => keytar.findCredentials(svc).then((cs) => cs.map((c) => ({ account: c.account }))),
      };
      return this._impl;
    } catch (_) { /* none available */ }

    throw new Error(
      'No OS keychain module found. Install one for on-device custody: ' +
      '`npm i @napi-rs/keyring` (preferred) or `npm i keytar`. ' +
      "Tests/CI use MemoryKeychainBackend and don't need this."
    );
  }

  get kind() { return this._kind; }

  async set(service, account, secret) { return this._load().set(service, account, secret); }
  async get(service, account) { const v = await this._load().get(service, account); return v == null ? null : v; }
  async delete(service, account) { return this._load().delete(service, account); }
  async list(service) {
    const impl = this._load();
    return impl.list ? impl.list(service) : [];
  }
}

module.exports = { OsKeychainBackend };
