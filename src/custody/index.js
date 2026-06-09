'use strict';

const provider = require('./provider');
const { LocalKeychainProvider, DEFAULT_SERVICE, EXPIRY_SKEW_MS } = require('./localKeychainProvider');
const { ServerBrokerProvider, BROKER_CONTRACT } = require('./serverBrokerProvider');

/**
 * Factory for the custody seam.
 *   createCustodyProvider('local-keychain', { keychain, metadata, refreshAccessToken })  -> ships in v1
 *   createCustodyProvider('server-broker',  { ... })                                     -> gated stub (Part 1-D)
 */
function createCustodyProvider(kind, config = {}) {
  switch (kind) {
    case 'local-keychain': return new LocalKeychainProvider(config);
    case 'server-broker': return new ServerBrokerProvider(config);
    default:
      throw new Error(`Unknown custody kind: ${kind} (expected 'local-keychain' or 'server-broker')`);
  }
}

module.exports = {
  createCustodyProvider,
  LocalKeychainProvider,
  ServerBrokerProvider,
  BROKER_CONTRACT,
  DEFAULT_SERVICE,
  EXPIRY_SKEW_MS,
  ...provider,
};
