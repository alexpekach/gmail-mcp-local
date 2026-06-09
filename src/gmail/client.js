'use strict';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo';

async function defaultGet(url, headers) {
  const resp = await fetch(url, { headers: headers || {} });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) { const e = new Error(`Gmail GET failed (${resp.status}): ${JSON.stringify(json)}`); e.status = resp.status; e.body = json; throw e; }
  return json;
}

async function defaultSend(method, url, headers, body) {
  const resp = await fetch(url, {
    method,
    headers: { ...(headers || {}), 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (method === 'DELETE' && (resp.status === 204 || resp.status === 200)) return { deleted: true };
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) { const e = new Error(`Gmail ${method} failed (${resp.status}): ${JSON.stringify(json)}`); e.status = resp.status; e.body = json; throw e; }
  return json;
}

/**
 * Gmail REST client. All HTTP is injectable (httpGet / httpSend) so tools are
 * unit-testable without live Gmail. Methods: get, post, patch, del, grantedScopes.
 */
function createGmailClient({ httpGet, httpSend, base = GMAIL_BASE, tokeninfoUrl = TOKENINFO_URL } = {}) {
  const doGet = httpGet || defaultGet;
  const doSend = httpSend || defaultSend;

  function buildUrl(path, query) {
    const url = new URL(base + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
    return url.toString();
  }
  const auth = (token) => ({ authorization: `Bearer ${token}` });

  async function get(token, path, query) { return doGet(buildUrl(path, query), auth(token)); }
  async function post(token, path, body) { return doSend('POST', base + path, auth(token), body || {}); }
  async function patch(token, path, body) { return doSend('PATCH', base + path, auth(token), body || {}); }
  async function del(token, path) { return doSend('DELETE', base + path, auth(token), null); }

  async function grantedScopes(token) {
    const info = await doGet(`${tokeninfoUrl}?access_token=${encodeURIComponent(token)}`, {});
    return String(info.scope || '').split(' ').filter(Boolean);
  }

  return { get, post, patch, del, grantedScopes, base };
}

module.exports = { createGmailClient, GMAIL_BASE, TOKENINFO_URL };
