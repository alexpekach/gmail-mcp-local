'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAttachments, attachmentSummary, mimeFromPath, isInside } = require('../src/gmail/attachments');
const { buildMimeMessage } = require('../src/gmail/mime');
const { buildTools } = require('../src/mcp/tools');
const { mergeConfig } = require('../src/config');

// Sandbox: <tmp>/root is the only allowed root; <tmp>/outside is not.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gmcp-att-'));
const ROOT = path.join(TMP, 'root');
const OUTSIDE = path.join(TMP, 'outside');
fs.mkdirSync(ROOT);
fs.mkdirSync(OUTSIDE);
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const POLICY = { roots: [ROOT] };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function writeFile(dir, name, buf) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}

// Pull every attachment part's decoded bytes out of a raw message.
function decodeParts(raw) {
  const txt = Buffer.from(raw, 'base64url').toString('utf-8');
  const boundary = /boundary="([^"]+)"/.exec(txt)[1];
  return txt.split(`--${boundary}`).slice(1, -1)
    .filter((p) => /Content-Disposition: (attachment|inline)/.test(p))
    .map((p) => {
      const [head, body] = p.split('\r\n\r\n');
      return { head, lines: body.trim().split('\r\n'), bytes: Buffer.from(body.replace(/\s+/g, ''), 'base64') };
    });
}

test('file_path: server reads the file; bytes, filename and mime round-trip into the MIME message', () => {
  const pdf = crypto.randomBytes(200 * 1024);
  const p = writeFile(ROOT, 'Quote QT-1.pdf', pdf);
  const atts = resolveAttachments([{ file_path: p }], POLICY);
  assert.strictEqual(atts[0].filename, 'Quote QT-1.pdf');
  assert.strictEqual(atts[0].mime_type, 'application/pdf');
  assert.strictEqual(atts[0].size_bytes, pdf.length);
  assert.strictEqual(atts[0].sha256, sha(pdf));
  assert.strictEqual(atts[0].source, 'file_path');

  const parts = decodeParts(buildMimeMessage({ to: ['a@b.com'], subject: 's', body: 'b', attachments: atts }));
  assert.strictEqual(parts.length, 1);
  assert.match(parts[0].head, /Content-Type: application\/pdf; name="Quote QT-1.pdf"/);
  assert.ok(parts[0].bytes.equals(pdf), 'decoded attachment must equal the source file byte-for-byte');
  assert.ok(parts[0].lines.every((l) => l.length <= 76), 'base64 lines must be <= 76 chars (RFC 2045)');
});

test('file_path: explicit filename / mime_type override the inferred ones', () => {
  const p = writeFile(ROOT, 'raw.bin', Buffer.from('xyz'));
  const [a] = resolveAttachments([{ file_path: p, filename: 'renamed.txt', mime_type: 'text/plain' }], POLICY);
  assert.strictEqual(a.filename, 'renamed.txt');
  assert.strictEqual(a.mime_type, 'text/plain');
});

test('size cap: total bytes over maxTotalBytes is rejected with a clear error', () => {
  const p = writeFile(ROOT, 'big.bin', Buffer.alloc(2048));
  assert.throws(() => resolveAttachments([{ file_path: p }], { ...POLICY, maxTotalBytes: 1024 }), (e) => e.code === 'bad_attachment' && /exceeds the 1024-byte cap/.test(e.message));
  // the cap is on the SUM, not per file
  const q = writeFile(ROOT, 'half.bin', Buffer.alloc(600));
  assert.throws(() => resolveAttachments([{ file_path: q }, { file_path: q }], { ...POLICY, maxTotalBytes: 1024 }), /exceeds/);
  assert.strictEqual(resolveAttachments([{ file_path: q }], { ...POLICY, maxTotalBytes: 1024 }).length, 1);
});

test('missing file is rejected', () => {
  assert.throws(() => resolveAttachments([{ file_path: path.join(ROOT, 'nope.pdf') }], POLICY), (e) => e.code === 'bad_attachment' && /not found/.test(e.message));
});

test('directory is rejected', () => {
  const d = path.join(ROOT, 'adir');
  fs.mkdirSync(d);
  assert.throws(() => resolveAttachments([{ file_path: d }], POLICY), /is a directory/);
});

test('relative path is rejected', () => {
  assert.throws(() => resolveAttachments([{ file_path: 'root/x.pdf' }], POLICY), /must be absolute/);
});

test('both or neither of data_base64 / file_path is rejected', () => {
  const p = writeFile(ROOT, 'both.txt', Buffer.from('x'));
  assert.throws(() => resolveAttachments([{ file_path: p, data_base64: 'eA==', filename: 'x' }], POLICY), /exactly one/);
  assert.throws(() => resolveAttachments([{ filename: 'x', mime_type: 'text/plain' }], POLICY), /one of data_base64 or file_path is required/);
});

test('file outside the allowed roots is rejected', () => {
  const p = writeFile(OUTSIDE, 'secret.txt', Buffer.from('s'));
  assert.throws(() => resolveAttachments([{ file_path: p }], POLICY), /outside the allowed attachment roots/);
  // and ../ traversal that lexically starts inside ROOT is judged by its real path
  assert.throws(() => resolveAttachments([{ file_path: path.join(ROOT, '..', 'outside', 'secret.txt') }], POLICY), /outside the allowed/);
});

test('symlink / junction escaping the allowed root is rejected', (t) => {
  writeFile(OUTSIDE, 'escape.txt', Buffer.from('e'));
  const link = path.join(ROOT, 'link');
  try {
    fs.symlinkSync(OUTSIDE, link, 'junction'); // junction needs no admin on Windows; plain dir symlink elsewhere
  } catch (e) {
    t.skip(`cannot create a link here: ${e.code}`);
    return;
  }
  assert.throws(() => resolveAttachments([{ file_path: path.join(link, 'escape.txt') }], POLICY), /outside the allowed attachment roots/);
});

test('isInside: sibling with a shared prefix is NOT inside', () => {
  assert.strictEqual(isInside(path.join(TMP, 'root'), path.join(TMP, 'root2', 'f')), false);
  assert.strictEqual(isInside(path.join(TMP, 'root'), path.join(TMP, 'root', 'f')), true);
});

// ---- negative control: a truncated read must be caught ------------------------

// fs wrapper whose readFileSync returns only the first `keep` bytes, the way the
// 2026-08-03 PDF arrived as 4,500 of 12,915 bytes.
function truncatingFs(keep) {
  return { ...fs, realpathSync: fs.realpathSync, statSync: fs.statSync, readFileSync: (p) => fs.readFileSync(p).subarray(0, keep) };
}

test('negative control: a short read is refused (stat size vs bytes read), not attached smaller', () => {
  const src = crypto.randomBytes(12915);
  const p = writeFile(ROOT, 'truncated.pdf', src);
  assert.throws(() => resolveAttachments([{ file_path: p }], { ...POLICY, fs: truncatingFs(4500) }), /short read .* read 4500 bytes but the file is 12915 bytes/);
  // control: the same injected fs path with no truncation passes, so the check above is what fired
  const ok = resolveAttachments([{ file_path: p }], { ...POLICY, fs: truncatingFs(Infinity) });
  assert.strictEqual(ok[0].size_bytes, 12915);
});

test('negative control: truncated data_base64 is exposed by the size_bytes / sha256 echo', () => {
  const src = crypto.randomBytes(12915);
  const truncatedB64 = src.toString('base64').slice(0, 6000); // 6000 b64 chars = 4500 bytes
  const [echo] = attachmentSummary(resolveAttachments([{ filename: 'q.pdf', data_base64: truncatedB64 }], POLICY));
  assert.strictEqual(echo.size_bytes, 4500);
  assert.notStrictEqual(echo.size_bytes, src.length, 'the echo must differ from the source size so a caller can catch it');
  assert.notStrictEqual(echo.sha256, sha(src));
  // control: the intact payload echoes the source size and hash exactly
  const [good] = attachmentSummary(resolveAttachments([{ filename: 'q.pdf', data_base64: src.toString('base64') }], POLICY));
  assert.strictEqual(good.size_bytes, src.length);
  assert.strictEqual(good.sha256, sha(src));
});

// ---- misc --------------------------------------------------------------------

test('data_base64 still works (url-safe accepted) and requires filename', () => {
  const [a] = resolveAttachments([{ filename: 'n.txt', data_base64: Buffer.from('hi??').toString('base64url') }], POLICY);
  assert.strictEqual(Buffer.from(a.data_base64, 'base64').toString(), 'hi??');
  assert.strictEqual(a.mime_type, 'text/plain');
  assert.throws(() => resolveAttachments([{ data_base64: 'eA==' }], POLICY), /filename is required/);
});

test('filename header injection characters are neutralized', () => {
  const [a] = resolveAttachments([{ filename: 'a"\r\nBcc: x@y.z.txt', data_base64: 'eA==' }], POLICY);
  assert.ok(!/["\r\n]/.test(a.filename));
});

test('mimeFromPath falls back to application/octet-stream', () => {
  assert.strictEqual(mimeFromPath('C:/x/Plan.DWG'), 'application/acad');
  assert.strictEqual(mimeFromPath('/x/unknown.zzz'), 'application/octet-stream');
});

test('config: attachmentRoots from file or env (path-delimiter list), maxAttachmentBytes numeric', () => {
  assert.deepStrictEqual(mergeConfig({}, { attachmentRoots: ['C:/a', 'C:/b'] }).attachmentRoots, ['C:/a', 'C:/b']);
  assert.deepStrictEqual(mergeConfig({ GMAIL_MCP_ATTACHMENT_ROOTS: ['/a', '/b'].join(path.delimiter) }, {}).attachmentRoots, ['/a', '/b']);
  assert.strictEqual(mergeConfig({}, {}).attachmentRoots, undefined);
  assert.strictEqual(mergeConfig({}, { maxAttachmentBytes: 1000 }).maxAttachmentBytes, 1000);
});

// ---- tool level --------------------------------------------------------------

function toolByName(name) { return buildTools().find((x) => x.name === name); }

test('create_draft with file_path: echoes filename/size/sha256 and posts the real bytes', async () => {
  const pdf = crypto.randomBytes(50 * 1024);
  const p = writeFile(ROOT, 'draft.pdf', pdf);
  let posted;
  const gmail = { post: async (tok, url, body) => { posted = body; return { id: 'D1', message: { id: 'M1', threadId: 'T1' } }; }, get: async () => ({}) };
  const custody = { getAccessToken: async () => 'TOK' };
  const res = await toolByName('create_draft').handler({ account: 'w', to: ['a@b.com'], subject: 's', body: 'b', attachments: [{ file_path: p }] }, { custody, gmail, attachmentPolicy: POLICY });
  assert.deepStrictEqual(res.attachments, [{ filename: 'draft.pdf', mime_type: 'application/pdf', size_bytes: pdf.length, sha256: sha(pdf), source: 'file_path' }]);
  assert.ok(decodeParts(posted.message.raw)[0].bytes.equals(pdf));
});

test('send_message: a bad attachment fails BEFORE any token mint or Gmail call', async () => {
  let tokenCalls = 0; let gmailCalls = 0;
  const custody = { getAccessToken: async () => { tokenCalls++; return 'TOK'; } };
  const gmail = { post: async () => { gmailCalls++; return {}; }, get: async () => { gmailCalls++; return {}; } };
  await assert.rejects(() => toolByName('send_message').handler({ account: 'w', to: ['a@b.com'], attachments: [{ file_path: path.join(ROOT, 'missing.pdf') }] }, { custody, gmail, attachmentPolicy: POLICY }), /not found/);
  assert.strictEqual(tokenCalls, 0);
  assert.strictEqual(gmailCalls, 0);
});

test('schema: attachment items accept file_path and no longer hard-require data_base64', () => {
  const items = toolByName('create_draft').inputSchema.properties.attachments.items;
  assert.ok(items.properties.file_path);
  assert.ok(!(items.required || []).includes('data_base64'));
});
