'use strict';

const fs = require('node:fs');

/**
 * Local non-secret metadata for connected mailboxes (email, tag, timestamps).
 *
 * SECURITY INVARIANT: only ALLOWED_FIELDS are ever persisted. Anything else
 * (e.g. a stray refresh_token / access_token) is dropped on write. This makes
 * the "no secret on disk via metadata" guarantee STRUCTURAL, not by convention —
 * even a buggy caller cannot leak a token through this store.
 *
 * Pass { path } for a JSON-file-backed store (real use), or omit it for an
 * in-memory store (tests).
 */
const ALLOWED_FIELDS = ['email', 'tag', 'has_refresh_token', 'created_at', 'last_used_at'];

function pick(fields) {
  const out = {};
  const src = fields || {};
  for (const k of ALLOWED_FIELDS) if (k in src) out[k] = src[k];
  return out;
}

class MetadataStore {
  constructor({ path } = {}) {
    this.path = path || null;
    this._data = (this.path && fs.existsSync(this.path)) ? this._read() : {};
  }

  _read() {
    try { return JSON.parse(fs.readFileSync(this.path, 'utf8')) || {}; }
    catch (_) { return {}; }
  }

  _write() {
    if (this.path) fs.writeFileSync(this.path, JSON.stringify(this._data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  async upsert(ref, fields) {
    const cur = this._data[ref] || {};
    this._data[ref] = { ...cur, ...pick(fields), ref };
    this._write();
    return this._data[ref];
  }

  async get(ref) { return this._data[ref] || null; }

  async touch(ref, iso) {
    if (!this._data[ref]) return null;
    this._data[ref].last_used_at = iso || new Date().toISOString();
    this._write();
    return this._data[ref];
  }

  async remove(ref) {
    delete this._data[ref];
    this._write();
    return { removed: true, ref };
  }

  async list() { return Object.values(this._data); }

  /** test-only: exactly what would be persisted */
  _serialize() { return JSON.stringify(this._data); }
}

function createMetadataStore(opts) { return new MetadataStore(opts); }

module.exports = { MetadataStore, createMetadataStore, ALLOWED_FIELDS };
