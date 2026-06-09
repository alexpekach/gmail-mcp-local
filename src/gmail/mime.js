'use strict';

const crypto = require('node:crypto');

/**
 * Build a base64url-encoded RFC 2822 message for Gmail drafts/sends.
 * Ported verbatim from the prototype (functions/gmail_mcp/lib/tools.js) — proven
 * in production. Handles plain, html, multipart/alternative, and attachments.
 */
function buildMimeMessage({ to = [], cc = [], bcc = [], subject = '', body = '', html_body = '', from, in_reply_to, references, attachments = [] } = {}) {
  const boundary = `boundary_${crypto.randomBytes(16).toString('hex')}`;
  const lines = [];
  if (from) lines.push(`From: ${from}`);
  if (to.length) lines.push(`To: ${to.join(', ')}`);
  if (cc.length) lines.push(`Cc: ${cc.join(', ')}`);
  if (bcc.length) lines.push(`Bcc: ${bcc.join(', ')}`);
  lines.push(`Subject: ${subject}`);
  if (in_reply_to) lines.push(`In-Reply-To: ${in_reply_to}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('MIME-Version: 1.0');

  const hasAttachments = attachments && attachments.length > 0;
  const hasBothBodies = body && html_body;

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    if (hasBothBodies) {
      const altBoundary = `alt_${crypto.randomBytes(8).toString('hex')}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push('');
      lines.push(`--${altBoundary}`);
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(body).toString('base64'));
      lines.push(`--${altBoundary}`);
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(html_body).toString('base64'));
      lines.push(`--${altBoundary}--`);
    } else if (html_body) {
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(html_body).toString('base64'));
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(body || '').toString('base64'));
    }
    for (const att of attachments) {
      lines.push(`--${boundary}`);
      const disp = att.inline ? 'inline' : 'attachment';
      lines.push(`Content-Type: ${att.mime_type}; name="${att.filename}"`);
      lines.push(`Content-Disposition: ${disp}; filename="${att.filename}"`);
      lines.push('Content-Transfer-Encoding: base64');
      if (att.inline) lines.push(`Content-Id: <${att.filename}>`);
      lines.push('');
      lines.push(String(att.data_base64).replace(/-/g, '+').replace(/_/g, '/'));
    }
    lines.push(`--${boundary}--`);
  } else if (hasBothBodies) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(body).toString('base64'));
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(html_body).toString('base64'));
    lines.push(`--${boundary}--`);
  } else if (html_body) {
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(html_body).toString('base64'));
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(body || '').toString('base64'));
  }

  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

/**
 * Resolve reply threading headers from the message being replied to. Best-effort;
 * uses the injected Gmail client. Returns {} if no replyToMessageId.
 */
async function resolveReplyHeaders(gmail, token, replyToMessageId) {
  if (!replyToMessageId) return {};
  const msg = await gmail.get(token, `/users/me/messages/${encodeURIComponent(replyToMessageId)}`, {
    format: 'metadata',
    metadataHeaders: 'Message-ID,References,Subject',
  });
  const headers = (msg.payload && msg.payload.headers) || [];
  const h = (name) => (headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase()) || {}).value || '';
  const msgId = h('Message-ID');
  const refs = h('References');
  return {
    thread_id: msg.threadId,
    in_reply_to: msgId,
    references: refs ? `${refs} ${msgId}` : msgId,
  };
}

module.exports = { buildMimeMessage, resolveReplyHeaders };
