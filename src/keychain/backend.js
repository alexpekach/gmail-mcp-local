'use strict';

/**
 * KeychainBackend — secret-storage abstraction behind the custody seam.
 *
 * Implementations:
 *   - MemoryKeychainBackend  (tests / CI — no native deps)
 *   - OsKeychainBackend      (macOS Keychain / Windows Credential Manager / libsecret)
 *
 * All methods are async:
 *   set(service, account, secret) -> void
 *   get(service, account)         -> string | null
 *   delete(service, account)      -> void
 *   list(service)                 -> Array<{ account: string }>   // accounts only, never secrets
 */
class KeychainBackend {
  async set(_service, _account, _secret) { throw new Error('KeychainBackend.set not implemented'); }
  async get(_service, _account) { throw new Error('KeychainBackend.get not implemented'); }
  async delete(_service, _account) { throw new Error('KeychainBackend.delete not implemented'); }
  async list(_service) { throw new Error('KeychainBackend.list not implemented'); }
}

module.exports = { KeychainBackend };
