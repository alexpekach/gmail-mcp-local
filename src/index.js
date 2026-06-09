'use strict';

const custody = require('./custody');
const { tokenFor } = require('./tokenFor');
const google = require('./oauth/google');
const { connectAccount } = require('./oauth/connect');
const { MemoryKeychainBackend } = require('./keychain/memoryKeychainBackend');
const { OsKeychainBackend } = require('./keychain/osKeychainBackend');
const { createMetadataStore } = require('./metadata/store');

/**
 * Convenience wiring for real on-device use: OS keychain + file-backed metadata +
 * Google refresh, exposing a custody provider, connect(), and token().
 *
 * @example
 *   const gc = createGoogleLocalCustody({ clientId, metadataPath: '~/.gmail-mcp/accounts.json' });
 *   await gc.connect({ ref: 'work', tag: 'work' });   // opens browser, PKCE+loopback
 *   const accessToken = await gc.token('work');       // minted from the keychain refresh token
 */
function createGoogleLocalCustody({ clientId, clientSecret, keychain, metadata, metadataPath, scopes } = {}) {
  if (!clientId) throw new Error('clientId required');
  const kc = keychain || new OsKeychainBackend();
  const md = metadata || createMetadataStore({ path: metadataPath });
  const refreshAccessToken = google.makeRefreshAccessToken({ clientId, clientSecret });
  const provider = new custody.LocalKeychainProvider({ keychain: kc, metadata: md, refreshAccessToken });
  return {
    provider,
    connect: (opts) => connectAccount({ custody: provider, clientId, clientSecret, scopes, ...opts }),
    token: (ref) => tokenFor(ref, { custody: provider }),
    list: () => provider.listAccounts(),
    remove: (ref) => provider.removeAccount(ref),
  };
}

module.exports = {
  ...custody,
  tokenFor,
  google,
  connectAccount,
  createGoogleLocalCustody,
  MemoryKeychainBackend,
  OsKeychainBackend,
  createMetadataStore,
};
