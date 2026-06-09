'use strict';

/** Gmail message parsing helpers (ported from the prototype's tools.js). */

function headerGetter(headers) {
  return (name) => (headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase()) || {}).value || '';
}

function extractBody(payload) {
  if (!payload) return { text: '', html: '' };
  let text = '';
  let html = '';
  function walk(part) {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const data = part.body && part.body.data;
    if (data) {
      const norm = String(data).replace(/-/g, '+').replace(/_/g, '/'); // url-safe → standard b64
      const decoded = Buffer.from(norm, 'base64').toString('utf-8');
      if (mime === 'text/plain' && !text) text = decoded;
      if (mime === 'text/html' && !html) html = decoded;
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return { text, html };
}

function parseMessage(msg) {
  const headers = (msg.payload && msg.payload.headers) || [];
  const h = headerGetter(headers);
  const body = extractBody(msg.payload);
  return {
    message_id: msg.id,
    thread_id: msg.threadId,
    label_ids: msg.labelIds || [],
    snippet: msg.snippet,
    from: h('From'), to: h('To'), cc: h('Cc'), subject: h('Subject'), date: h('Date'),
    body_text: body.text, body_html: body.html,
    internal_date: msg.internalDate,
  };
}

module.exports = { parseMessage, extractBody, headerGetter };
