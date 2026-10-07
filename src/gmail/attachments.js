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

// All file I/O is async and time-boxed. This runs inside the MCP server: a sync
// read of an unmounted network/cloud drive (e.g. a Drive-for-desktop G:) can
// block forever, freezing EVERY tool until restart. The libuv worker may still
// hang, but the event loop does not, and the caller gets a clear error.
const DEFAULT_IO_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(attachmentError(`${what} did not respond within ${ms} ms (unmounted or offline drive?)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function realRoots(roots, fsp, ioTimeoutMs) {
  const out = [];
  for (const r of roots) {
    if (!r || !path.isAbsolute(r)) continue;
    try { out.push(await withTimeout(fsp.realpath(r), ioTimeoutMs, `attachment root ${r}`)); } catch (_) { /* missing or unreachable root: skip */ }
  }
  return out;
}

async function readFromPath(filePath, { roots, fsp, ioTimeoutMs, budgetBytes }) {
  if (typeof filePath !== 'string' || !filePath) throw attachmentError('file_path must be a non-empty string');
  if (!path.isAbsolute(filePath)) throw attachmentError(`file_path must be absolute: ${filePath}`);
  const allowed = await realRoots(roots, fsp, ioTimeoutMs);
  // Lexical pre-check BEFORE touching the file system, so a path on a drive that
  // is not allowed (and may hang) is refused without any I/O on it. Configured
  // roots and their real paths both count, so either spelling of a root works.
  const lexical = path.resolve(filePath);
  if (![...roots, ...allowed].some((root) => path.isAbsolute(root) && isInside(path.resolve(root), lexical))) {
    throw attachmentError(`file_path is outside the allowed attachment roots: ${filePath}. Allowed: ${allowed.join(', ') || '(none)'}`);
  }
  let real;
  try {
    real = await withTimeout(fsp.realpath(filePath), ioTimeoutMs, `file_path ${filePath}`);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw attachmentError(`file_path not found: ${filePath}`);
    if (e && e.code === 'bad_attachment') throw e;
    throw attachmentError(`file_path not readable: ${filePath} (${e && e.code ? e.code : e.message})`);
  }
  // The real path (symlinks and junctions followed) is what decides.
  if (!allowed.some((root) => isInside(root, real))) {
    throw attachmentError(`file_path is outside the allowed attachment roots: ${filePath} (resolves to ${real}). Allowed: ${allowed.join(', ') || '(none)'}`);
  }
  const st = await withTimeout(fsp.stat(real), ioTimeoutMs, `file_path ${filePath}`);
  if (st.isDirectory()) throw attachmentError(`file_path is a directory, not a file: ${filePath}`);
  if (!st.isFile()) throw attachmentError(`file_path is not a regular file: ${filePath}`);
  // Cap BEFORE reading, so a huge file is never pulled into memory.
  if (st.size > budgetBytes) throw capError(st.size, budgetBytes, filePath);
  const buf = await withTimeout(fsp.readFile(real), ioTimeoutMs, `file_path ${filePath}`);
  if (buf.length !== st.size) {
    throw attachmentError(`short read on ${filePath}: read ${buf.length} bytes but the file is ${st.size} bytes; refusing to attach a truncated file`);
  }
  return { buf, real };
}

function capError(bytes, budget, what) {
  return attachmentError(`attachment ${what} is ${bytes} bytes; only ${budget} bytes remain under the attachment cap (Gmail limits a message to 25 MB after base64 encoding). Share large files by link instead.`);
}

/**
 * @param {Array} items  attachment items from the tool args
 * @param {object} [opts]
 * @param {string[]} [opts.roots]          allowed roots for file_path (default [homedir])
 * @param {number}   [opts.maxTotalBytes]  cap on summed attachment bytes
 * @param {number}   [opts.ioTimeoutMs]    per-operation file I/O timeout
 * @param {object}   [opts.fsp]            injectable fs.promises-shaped object (tests)
 * @returns {Promise<Array<{filename, mime_type, inline, data_base64, size_bytes, sha256, source}>>}
 */
async function resolveAttachments(items, { roots, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES, ioTimeoutMs = DEFAULT_IO_TIMEOUT_MS, fsp = nodeFs.promises } = {}) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw attachmentError('attachments must be an array');
  const allowRoots = roots && roots.length ? roots : [os.homedir()];
  const out = [];
  let total = 0;
  for (const [i, item] of items.entries()) {
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
      ({ buf } = await readFromPath(item.file_path, { roots: allowRoots, fsp, ioTimeoutMs, budgetBytes: maxTotalBytes - total }));
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
  }
  return out;
}

// What the tool result echoes back: no bytes, just what is needed to verify.
function attachmentSummary(resolved) {
  return resolved.map(({ filename, mime_type, size_bytes, sha256, source }) => ({ filename, mime_type, size_bytes, sha256, source }));
}

module.exports = { resolveAttachments, attachmentSummary, mimeFromPath, isInside, DEFAULT_MAX_TOTAL_BYTES, DEFAULT_IO_TIMEOUT_MS };
