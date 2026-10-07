'use strict';

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Resolve create_draft / send_message attachment items into MIME-ready parts.
 *
 * Each item carries EXACTLY ONE source:
 *   - data_base64: inline bytes from the caller (legacy; the model must emit them)
 *   - file_path:   an absolute local path the SERVER reads itself
 *
 * file_path guardrails: absolute only; resolved to its real path (symlinks and
 * junctions followed) and that real path must sit inside an allowed root (default:
 * the user's home dir); directories and non-regular files are rejected; the bytes
 * read must equal stat.size (a short read is an error, never a smaller attachment);
 * total attachment bytes are capped. File contents are never logged.
 *
 * Every resolved part reports size_bytes + sha256 so callers can verify the
 * attachment against the source file.
 */

// Gmail caps a whole message at 25 MB and base64 inflates bytes by ~4/3 (plus
// line breaks), so ~18 MB of raw attachment bytes is the practical ceiling.
const DEFAULT_MAX_TOTAL_BYTES = 18 * 1024 * 1024;

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.eml': 'message/rfc822',
  '.ics': 'text/calendar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
};

function attachmentError(msg) {
  const e = new Error(msg);
  e.code = 'bad_attachment';
  return e;
}

function mimeFromPath(p) {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

// Strip characters that would break out of a quoted MIME header parameter.
function safeFilename(name) {
  return String(name).replace(/[\r\n"\\]/g, '_');
}

const caseFold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function isInside(root, target) {
  const rel = path.relative(caseFold(root), caseFold(target));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return rel.split(path.sep)[0] !== '..';
}

function realRoots(roots, fs) {
  const out = [];
  for (const r of roots) {
    if (!r || !path.isAbsolute(r)) continue;
    try { out.push(fs.realpathSync.native ? fs.realpathSync.native(r) : fs.realpathSync(r)); } catch (_) { /* missing root: skip */ }
  }
  return out;
}

function readFromPath(filePath, { roots, fs }) {
  if (typeof filePath !== 'string' || !filePath) throw attachmentError('file_path must be a non-empty string');
  if (!path.isAbsolute(filePath)) throw attachmentError(`file_path must be absolute: ${filePath}`);
  let real;
  try {
    real = fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw attachmentError(`file_path not found: ${filePath}`);
    throw attachmentError(`file_path not readable: ${filePath} (${e && e.code ? e.code : e.message})`);
  }
  const allowed = realRoots(roots, fs);
  if (!allowed.some((root) => isInside(root, real))) {
    throw attachmentError(`file_path is outside the allowed attachment roots: ${filePath}${real !== filePath ? ` (resolves to ${real})` : ''}. Allowed: ${allowed.join(', ') || '(none)'}`);
  }
  const st = fs.statSync(real);
  if (st.isDirectory()) throw attachmentError(`file_path is a directory, not a file: ${filePath}`);
  if (!st.isFile()) throw attachmentError(`file_path is not a regular file: ${filePath}`);
  const buf = fs.readFileSync(real);
  if (buf.length !== st.size) {
    throw attachmentError(`short read on ${filePath}: read ${buf.length} bytes but the file is ${st.size} bytes; refusing to attach a truncated file`);
  }
  return { buf, real };
}

/**
 * @param {Array} items  attachment items from the tool args
 * @param {object} [opts]
 * @param {string[]} [opts.roots]          allowed roots for file_path (default [homedir])
 * @param {number}   [opts.maxTotalBytes]  cap on summed attachment bytes
 * @param {object}   [opts.fs]             injectable fs (tests)
 * @returns {Array<{filename, mime_type, inline, data_base64, size_bytes, sha256, source}>}
 */
function resolveAttachments(items, { roots, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, fs = nodeFs } = {}) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw attachmentError('attachments must be an array');
  const allowRoots = roots && roots.length ? roots : [os.homedir()];
  const out = [];
  let total = 0;
  items.forEach((item, i) => {
    const where = `attachments[${i}]`;
    if (!item || typeof item !== 'object') throw attachmentError(`${where} must be an object`);
    const hasData = item.data_base64 !== undefined && item.data_base64 !== null && item.data_base64 !== '';
    const hasPath = item.file_path !== undefined && item.file_path !== null && item.file_path !== '';
    if (hasData && hasPath) throw attachmentError(`${where}: give exactly one of data_base64 or file_path, not both`);
    if (!hasData && !hasPath) throw attachmentError(`${where}: one of data_base64 or file_path is required`);

    let buf;
    let filename = item.filename;
    let mimeType = item.mime_type;
    if (hasPath) {
      ({ buf } = readFromPath(item.file_path, { roots: allowRoots, fs }));
      if (!filename) filename = path.basename(item.file_path);
      if (!mimeType) mimeType = mimeFromPath(item.file_path);
    } else {
      buf = Buffer.from(String(item.data_base64).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (!filename) throw attachmentError(`${where}: filename is required with data_base64`);
      if (!mimeType) mimeType = mimeFromPath(filename);
    }

    total += buf.length;
    if (total > maxTotalBytes) {
      throw attachmentError(`attachments total ${total} bytes exceeds the ${maxTotalBytes}-byte cap (Gmail limits a message to 25 MB after base64 encoding). Share large files by link instead.`);
    }
    out.push({
      filename: safeFilename(filename),
      mime_type: mimeType,
      inline: !!item.inline,
      data_base64: buf.toString('base64'),
      size_bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      source: hasPath ? 'file_path' : 'data_base64',
    });
  });
  return out;
}

// What the tool result echoes back: no bytes, just what is needed to verify.
function attachmentSummary(resolved) {
  return resolved.map(({ filename, mime_type, size_bytes, sha256, source }) => ({ filename, mime_type, size_bytes, sha256, source }));
}

module.exports = { resolveAttachments, attachmentSummary, mimeFromPath, isInside, DEFAULT_MAX_TOTAL_BYTES };
