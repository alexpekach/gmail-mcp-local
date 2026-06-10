'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

/**
 * MCP Streamable HTTP transport (single endpoint, JSON responses).
 *
 * Serves the same transport-agnostic server core (server.js handleMessage) over
 * HTTP so remote MCP clients (claude.ai custom connectors, web, mobile) can
 * reach a server running on YOUR machine — typically through a tunnel
 * (cloudflared / ngrok). Refresh tokens stay in the local OS keychain; nothing
 * about custody changes.
 *
 *   POST {basePath}/mcp   JSON-RPC request → 200 application/json response;
 *                         notification    → 202 Accepted (no body);
 *                         array (batch)   → 200 with array of responses.
 *   GET  {basePath}/mcp   405 (no server-initiated streams; allowed by spec).
 *   Anything else         404.
 *
 * Security model (personal/single-user): every request must carry the secret
 * path prefix — an unguessable URL is the credential. claude.ai custom
 * connectors support OAuth or nothing; for a single-user tunnel the secret
 * path is the pragmatic floor. Bind to 127.0.0.1 and let the tunnel terminate
 * TLS. Do NOT expose this listener directly to the internet on 0.0.0.0.
 */

function generateSecret() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Start the HTTP listener. Returns a promise resolving to { server, port, url, close }.
 * secret: path-prefix credential; pass '' to disable (tests / trusted networks only).
 */
function runHttpServer({ server, port = 0, host = '127.0.0.1', secret } = {}) {
  if (!server) throw new Error('server required');
  if (secret === undefined) secret = generateSecret();
  const basePath = secret ? `/${secret}` : '';
  const endpoint = `${basePath}/mcp`;

  const writeJson = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };

  const httpServer = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path !== endpoint) {
      // Wrong/missing secret: 404 with no detail — don't confirm the endpoint exists.
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 4 * 1024 * 1024) req.destroy(); // 4MB cap
    });
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (_) {
        writeJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      try {
        if (Array.isArray(msg)) {
          const out = (await Promise.all(msg.map((m) => server.handleMessage(m)))).filter(Boolean);
          if (out.length === 0) { res.writeHead(202).end(); return; }
          writeJson(res, 200, out);
          return;
        }
        const resp = await server.handleMessage(msg);
        if (!resp) { res.writeHead(202).end(); return; } // notification
        writeJson(res, 200, resp);
      } catch (e) {
        const id = (msg && !Array.isArray(msg) && msg.id !== undefined) ? msg.id : null;
        writeJson(res, 500, { jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${e && e.message ? e.message : e}` } });
      }
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const actualPort = httpServer.address().port;
      resolve({
        server: httpServer,
        port: actualPort,
        url: `http://${host}:${actualPort}${endpoint}`,
        close: () => new Promise((r) => httpServer.close(r)),
      });
    });
  });
}

module.exports = { runHttpServer, generateSecret };
