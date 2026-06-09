'use strict';

/**
 * Custody seam for the local-first Gmail MCP v1.
 *
 * A CustodyProvider owns the two custody concerns the prototype's tokenFor()
 * currently hard-codes against the Catalyst Data Store
 * (functions/gmail_mcp/lib/tools.js:90 + google.js:116):
 *   1. where the Google refresh token lives, and
 *   2. how a short-lived Gmail access token is obtained from it.
 *
 * v1 ships ONE implementation — LocalKeychainProvider (token in the user's OS
 * keychain, never leaves the device). ServerBrokerProvider is a gated stub so
 * the eventual Team tier (plan Part 1-D / §1.D.8) is a drop-in, not a rewrite.
 *
 * An `account ref` is an opaque string key for a connected mailbox (tag / label
 * / verified email). There is one user per local install, so refs are local and
 * collision-free — no tenant_id needed in v1.
 */

class CustodyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CustodyError';
    this.code = code || 'custody_error';
  }
}

class NotImplementedError extends CustodyError {
  constructor(message) {
    super(message, 'not_implemented');
    this.name = 'NotImplementedError';
  }
}

class AccountNotFoundError extends CustodyError {
  constructor(ref) {
    super(`No custody entry for account "${ref}". Connect the mailbox first.`, 'account_not_found');
    this.name = 'AccountNotFoundError';
    this.ref = ref;
  }
}

class TokenRefreshError extends CustodyError {
  constructor(message) {
    super(message, 'token_refresh_failed');
    this.name = 'TokenRefreshError';
  }
}

/**
 * @interface
 * All methods are async. Subclasses MUST override every method.
 */
class CustodyProvider {
  /** Store a refresh token + non-secret metadata for `ref`. */
  async putRefreshToken(_ref, _refreshToken, _meta) { throw new NotImplementedError('putRefreshToken not implemented'); }
  /** Return a usable, short-lived Gmail access token for `ref`. */
  async getAccessToken(_ref) { throw new NotImplementedError('getAccessToken not implemented'); }
  /** Remove all custody material + metadata for `ref`. */
  async removeAccount(_ref) { throw new NotImplementedError('removeAccount not implemented'); }
  /** Update NON-SECRET metadata (e.g. tag) for an existing account. Never touches the token. */
  async updateAccountMeta(_ref, _fields) { throw new NotImplementedError('updateAccountMeta not implemented'); }
  /** List connected accounts — metadata only, never secrets. */
  async listAccounts() { throw new NotImplementedError('listAccounts not implemented'); }
  /** Describe the trust properties of this custody model (for transparency/tests). */
  describe() { throw new NotImplementedError('describe not implemented'); }
}

module.exports = {
  CustodyProvider,
  CustodyError,
  NotImplementedError,
  AccountNotFoundError,
  TokenRefreshError,
};
