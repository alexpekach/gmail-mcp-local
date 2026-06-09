'use strict';

const { tokenFor } = require('../tokenFor');
const { parseMessage } = require('../gmail/parse');
const { buildMimeMessage, resolveReplyHeaders } = require('../gmail/mime');

/**
 * MCP tool registry for the local-first v1.
 *
 * Every mailbox-touching tool routes through tokenFor(ref, { custody }) — the
 * custody-agnostic chokepoint — so it works identically whether custody is local
 * (keychain, v1) or server (broker, deferred). deps = { custody, connect, gmail }.
 *
 * Account management: list_accounts, connect_account, remove_account, set_tag.
 * Read: search_threads, get_thread, list_labels, list_thread_attachments,
 *       get_attachment, check_account_scopes.
 * Write (need gmail.compose): create_draft, send_draft, send_message.
 * Modify (need gmail.modify): label_thread, label_message, create_label,
 *       update_label, delete_label, trash_thread, untrash_thread.
 */

const WRITE_SCOPES_REQUIRED = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
];

const enc = encodeURIComponent;

function requireArg(args, name) {
  const v = args ? args[name] : undefined;
  if (v === undefined || v === null || v === '') {
    const e = new Error(`${name} is required`);
    e.code = 'bad_args';
    throw e;
  }
  return v;
}

const ACCOUNT_PROP = { type: 'string', description: 'A connected account ref (see list_accounts).' };

// attachment payload schema reused by create_draft / send_message
const ATTACHMENTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      filename: { type: 'string' },
      mime_type: { type: 'string', description: 'e.g. application/pdf' },
      data_base64: { type: 'string', description: 'Base64-encoded bytes (standard or url-safe).' },
      inline: { type: 'boolean', description: 'Attach inline; reference via cid:filename in html_body.' },
    },
    required: ['filename', 'mime_type', 'data_base64'],
    additionalProperties: false,
  },
};

const COMPOSE_PROPS = {
  account: ACCOUNT_PROP,
  to: { type: 'array', items: { type: 'string' } },
  cc: { type: 'array', items: { type: 'string' } },
  bcc: { type: 'array', items: { type: 'string' } },
  subject: { type: 'string' },
  body: { type: 'string', description: 'Plain-text body.' },
  html_body: { type: 'string', description: 'HTML body. With body, sent as multipart/alternative.' },
  reply_to_message_id: { type: 'string', description: 'Message id to reply to (sets threading headers).' },
  from: { type: 'string', description: 'Optional From override (must be a verified send-as alias).' },
  attachments: ATTACHMENTS_SCHEMA,
};

async function composeRaw(deps, token, args) {
  const { account, reply_to_message_id, attachments, ...rest } = args;
  const replyCtx = await resolveReplyHeaders(deps.gmail, token, reply_to_message_id);
  const raw = buildMimeMessage({ ...rest, attachments, in_reply_to: replyCtx.in_reply_to, references: replyCtx.references });
  return { raw, threadId: replyCtx.thread_id };
}

function buildTools() {
  return [
    // ───── account management ─────────────────────────────────────────────
    {
      name: 'list_accounts',
      description: 'List the Google accounts connected on THIS device (metadata only — never tokens). Each entry has ref, email, tag, has_refresh_token. Optionally filter by tag.',
      inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'Optional: only accounts with this tag.' } }, additionalProperties: false },
      handler: async (args, deps) => {
        const all = await deps.custody.listAccounts();
        const tag = args.tag ? String(args.tag).toLowerCase() : null;
        const accounts = tag ? all.filter((a) => String(a.tag || '').toLowerCase() === tag) : all;
        return { accounts };
      },
    },
    {
      name: 'connect_account',
      description: 'Connect a Google account on THIS device via your browser (PKCE + loopback). The refresh token is stored in your OS keychain and never leaves the machine. Returns {ref, email, tag}.',
      inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'A short id you choose, e.g. "work".' }, tag: { type: 'string', description: 'Optional tag, e.g. "personal" / "work".' } }, required: ['ref'], additionalProperties: false },
      handler: async (args, deps) => {
        if (typeof deps.connect !== 'function') throw new Error('connect is not configured on this server');
        requireArg(args, 'ref');
        return deps.connect({ ref: args.ref, tag: args.tag });
      },
    },
    {
      name: 'remove_account',
      description: "Disconnect a Google account: deletes its refresh token from the keychain and its metadata. Does NOT revoke at Google — do that at https://myaccount.google.com/permissions.",
      inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false },
      handler: async (args, deps) => { requireArg(args, 'ref'); return deps.custody.removeAccount(args.ref); },
    },
    {
      name: 'set_tag',
      description: 'Change your tag for a connected account (e.g. switch "personal" to "work"). Metadata only — never touches the token.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, tag: { type: 'string', description: 'The new tag.' } }, required: ['account', 'tag'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'tag');
        await deps.custody.updateAccountMeta(args.account, { tag: args.tag });
        return { updated: true, ref: args.account, tag: args.tag };
      },
    },

    // ───── read ───────────────────────────────────────────────────────────
    {
      name: 'search_threads',
      description: 'Search Gmail threads in a connected account using Gmail search syntax (e.g. "from:bob newer_than:7d has:attachment"). Returns thread ids + snippets in one API call. Use get_thread for full content.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, query: { type: 'string', description: 'Gmail search query. Empty = latest threads.' }, max_results: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, page_token: { type: 'string' } }, required: ['account'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const query = { maxResults: args.max_results || 20 };
        if (args.query) query.q = args.query;
        if (args.page_token) query.pageToken = args.page_token;
        const data = await deps.gmail.get(token, '/users/me/threads', query);
        const threads = (data.threads || []).map((t) => ({ thread_id: t.id, snippet: t.snippet }));
        return { threads, next_page_token: data.nextPageToken || null, result_size_estimate: data.resultSizeEstimate || 0 };
      },
    },
    {
      name: 'get_thread',
      description: 'Fetch a Gmail thread by id, with each message parsed into readable headers + body text/html.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, thread_id: { type: 'string' }, format: { type: 'string', enum: ['full', 'metadata', 'minimal'], default: 'full' } }, required: ['account', 'thread_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'thread_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.get(token, `/users/me/threads/${enc(args.thread_id)}`, { format: args.format || 'full' });
        const messages = (data.messages || []).map(parseMessage);
        return { thread_id: data.id, snippet: data.snippet, history_id: data.historyId, messages };
      },
    },
    {
      name: 'list_labels',
      description: 'List Gmail labels (system + user) for a connected account.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP }, required: ['account'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.get(token, '/users/me/labels');
        return { labels: data.labels || [] };
      },
    },
    {
      name: 'list_thread_attachments',
      description: 'List metadata for all attachments in a thread — filename, mime_type, size_bytes, message_id, attachment_id. No bytes (cheap). Use get_attachment to fetch one.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, thread_id: { type: 'string' } }, required: ['account', 'thread_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'thread_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.get(token, `/users/me/threads/${enc(args.thread_id)}`, { format: 'full' });
        const attachments = [];
        for (const msg of (data.messages || [])) {
          const walk = (part) => {
            if (!part) return;
            if (part.filename && part.body && part.body.attachmentId) {
              attachments.push({ message_id: msg.id, attachment_id: part.body.attachmentId, filename: part.filename, mime_type: part.mimeType, size_bytes: part.body.size || 0 });
            }
            if (part.parts) part.parts.forEach(walk);
          };
          walk(msg.payload);
        }
        return { attachments };
      },
    },
    {
      name: 'get_attachment',
      description: 'Fetch one Gmail attachment by message_id + attachment_id (discover both via list_thread_attachments). Returns base64 bytes + filename/mime_type/size_bytes; for text-like MIMEs also data_text. Default cap 5MB.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, message_id: { type: 'string' }, attachment_id: { type: 'string' }, max_size_bytes: { type: 'integer', minimum: 1, description: 'Reject attachments larger than this. Default 5242880 (5MB).' } }, required: ['account', 'message_id', 'attachment_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'message_id'); requireArg(args, 'attachment_id');
        const max = args.max_size_bytes || 5 * 1024 * 1024;
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.get(token, `/users/me/messages/${enc(args.message_id)}/attachments/${enc(args.attachment_id)}`);
        const sizeBytes = data.size || 0;
        if (sizeBytes > max) throw new Error(`Attachment size ${sizeBytes} exceeds max_size_bytes ${max}`);
        const standardB64 = String(data.data || '').replace(/-/g, '+').replace(/_/g, '/');
        const result = { data_base64: standardB64, size_bytes: sizeBytes };
        const msg = await deps.gmail.get(token, `/users/me/messages/${enc(args.message_id)}`, { format: 'metadata' });
        const find = (part) => {
          if (!part) return null;
          if (part.body && part.body.attachmentId === args.attachment_id) return { mime: part.mimeType || '', filename: part.filename || '' };
          if (part.parts) { for (const p of part.parts) { const r = find(p); if (r) return r; } }
          return null;
        };
        const meta = find(msg.payload) || { mime: '', filename: '' };
        result.mime_type = meta.mime;
        result.filename = meta.filename;
        if (/^text\/|^application\/(json|xml|javascript)/.test(meta.mime)) {
          try { result.data_text = Buffer.from(standardB64, 'base64').toString('utf-8'); } catch (_) { /* binary */ }
        }
        return result;
      },
    },
    {
      name: 'check_account_scopes',
      description: 'Report the OAuth scopes currently granted on a connected account. Returns {granted_scopes[], has_write_scope, has_modify_scope, needs_reauth}. If needs_reauth, reconnect to grant compose/modify.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP }, required: ['account'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const granted = await deps.gmail.grantedScopes(token);
        const hasWrite = WRITE_SCOPES_REQUIRED.every((s) => granted.includes(s));
        return {
          granted_scopes: granted,
          has_write_scope: granted.includes('https://www.googleapis.com/auth/gmail.compose'),
          has_modify_scope: granted.includes('https://www.googleapis.com/auth/gmail.modify'),
          needs_reauth: !hasWrite,
        };
      },
    },

    // ───── write (gmail.compose) ───────────────────────────────────────────
    {
      name: 'create_draft',
      description: 'Create a Gmail draft. Returns {draft_id, message_id, thread_id}. For replies pass reply_to_message_id. Requires gmail.compose scope.',
      inputSchema: { type: 'object', properties: COMPOSE_PROPS, required: ['account'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const { raw, threadId } = await composeRaw(deps, token, args);
        const body = { message: { raw } };
        if (threadId) body.message.threadId = threadId;
        const data = await deps.gmail.post(token, '/users/me/drafts', body);
        return { draft_id: data.id, message_id: (data.message || {}).id, thread_id: (data.message || {}).threadId };
      },
    },
    {
      name: 'send_draft',
      description: 'Send a previously-created draft (review it in Gmail first). Returns {message_id, thread_id, label_ids}. Requires gmail.compose scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, draft_id: { type: 'string' } }, required: ['account', 'draft_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'draft_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, '/users/me/drafts/send', { id: args.draft_id });
        return { message_id: data.id, thread_id: data.threadId, label_ids: data.labelIds || [] };
      },
    },
    {
      name: 'send_message',
      description: 'Compose AND send in one step (no draft review). Same payload as create_draft. Returns {message_id, thread_id, label_ids}. Requires gmail.compose scope.',
      inputSchema: { type: 'object', properties: COMPOSE_PROPS, required: ['account'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const { raw, threadId } = await composeRaw(deps, token, args);
        const body = { raw };
        if (threadId) body.threadId = threadId;
        const data = await deps.gmail.post(token, '/users/me/messages/send', body);
        return { message_id: data.id, thread_id: data.threadId, label_ids: data.labelIds || [] };
      },
    },

    // ───── modify (gmail.modify) ──────────────────────────────────────────
    {
      name: 'label_thread',
      description: 'Add/remove labels on every message in a thread. INBOX/STARRED/UNREAD/IMPORTANT/SPAM/TRASH or user label ids. Mark read: remove ["UNREAD"]. Archive: remove ["INBOX"]. Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, thread_id: { type: 'string' }, add_label_ids: { type: 'array', items: { type: 'string' } }, remove_label_ids: { type: 'array', items: { type: 'string' } } }, required: ['account', 'thread_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'thread_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, `/users/me/threads/${enc(args.thread_id)}/modify`, { addLabelIds: args.add_label_ids || [], removeLabelIds: args.remove_label_ids || [] });
        return { thread_id: data.id, label_ids: data.labelIds || [] };
      },
    },
    {
      name: 'label_message',
      description: 'Same as label_thread but for a single message id. Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, message_id: { type: 'string' }, add_label_ids: { type: 'array', items: { type: 'string' } }, remove_label_ids: { type: 'array', items: { type: 'string' } } }, required: ['account', 'message_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'message_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, `/users/me/messages/${enc(args.message_id)}/modify`, { addLabelIds: args.add_label_ids || [], removeLabelIds: args.remove_label_ids || [] });
        return { message_id: data.id, label_ids: data.labelIds || [] };
      },
    },
    {
      name: 'create_label',
      description: 'Create a user label. Use "/" for nesting (e.g. "Clients/Acme"). Returns {id, name}. Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, name: { type: 'string' }, label_list_visibility: { type: 'string', enum: ['labelShow', 'labelShowIfUnread', 'labelHide'] }, message_list_visibility: { type: 'string', enum: ['show', 'hide'] } }, required: ['account', 'name'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'name');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, '/users/me/labels', { name: args.name, labelListVisibility: args.label_list_visibility || 'labelShow', messageListVisibility: args.message_list_visibility || 'show' });
        return { id: data.id, name: data.name };
      },
    },
    {
      name: 'update_label',
      description: 'Rename or change visibility of a user label. Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, label_id: { type: 'string' }, name: { type: 'string' }, label_list_visibility: { type: 'string', enum: ['labelShow', 'labelShowIfUnread', 'labelHide'] }, message_list_visibility: { type: 'string', enum: ['show', 'hide'] } }, required: ['account', 'label_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'label_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const patch = {};
        if (args.name) patch.name = args.name;
        if (args.label_list_visibility) patch.labelListVisibility = args.label_list_visibility;
        if (args.message_list_visibility) patch.messageListVisibility = args.message_list_visibility;
        const data = await deps.gmail.patch(token, `/users/me/labels/${enc(args.label_id)}`, patch);
        return { id: data.id, name: data.name };
      },
    },
    {
      name: 'delete_label',
      description: 'Permanently delete a user label (messages keep other labels). Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, label_id: { type: 'string' } }, required: ['account', 'label_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'label_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        await deps.gmail.del(token, `/users/me/labels/${enc(args.label_id)}`);
        return { deleted: true, label_id: args.label_id };
      },
    },
    {
      name: 'trash_thread',
      description: 'Move a thread to TRASH (reversible via untrash_thread). Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, thread_id: { type: 'string' } }, required: ['account', 'thread_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'thread_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, `/users/me/threads/${enc(args.thread_id)}/trash`, {});
        return { thread_id: data.id, label_ids: data.labelIds || [] };
      },
    },
    {
      name: 'untrash_thread',
      description: 'Restore a trashed thread to its previous labels. Requires gmail.modify scope.',
      inputSchema: { type: 'object', properties: { account: ACCOUNT_PROP, thread_id: { type: 'string' } }, required: ['account', 'thread_id'], additionalProperties: false },
      handler: async (args, deps) => {
        requireArg(args, 'account'); requireArg(args, 'thread_id');
        const token = await tokenFor(args.account, { custody: deps.custody });
        const data = await deps.gmail.post(token, `/users/me/threads/${enc(args.thread_id)}/untrash`, {});
        return { thread_id: data.id, label_ids: data.labelIds || [] };
      },
    },
  ];
}

module.exports = { buildTools, requireArg, WRITE_SCOPES_REQUIRED };
