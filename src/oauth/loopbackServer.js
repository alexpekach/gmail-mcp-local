'use strict';

const http = require('node:http');

/**
 * Ephemeral loopback redirect catcher for the native-app OAuth flow (RFC 8252).
 * Binds 127.0.0.1 on a random port and returns { redirectUri, waitForCode, close }.
 *
 * waitForCode() resolves { code } on the first request whose `state` matches,
 * and rejects on state mismatch (CSRF guard), an OAuth `error` param, or timeout.
 * The server binds to 127.0.0.1 only (never 0.0.0.0) so nothing off-host can reach it.
 */
function startLoopbackServer({ expectedState, timeoutMs = 300_000, path = '/oauth2/callback' } = {}) {
  if (!expectedState) throw new Error('expectedState required');

  return new Promise((resolveStart, rejectStart) => {
    let settle = null;
    const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    let timer = null;
    let finished = false;

    const server = http.createServer((req, res) => {
      let u;
      try { u = new URL(req.url, 'http://127.0.0.1'); } catch (_) { u = null; }
      if (!u || u.pathname !== path) { res.writeHead(404); res.end('not found'); return; }

      const params = u.searchParams;
      const respond = (msg) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Connected</title>` +
          `<body style="font-family:system-ui;padding:2rem"><h2>${msg}</h2>` +
          `<p>You can close this tab and return to your app.</p>`);
      };

      const err = params.get('error');
      if (err) { respond('Authorization failed.'); finish(new Error(`OAuth error: ${err}`)); return; }
      const state = params.get('state');
      const code = params.get('code');
      if (state !== expectedState) { respond('State mismatch — request rejected.'); finish(new Error('state mismatch (possible CSRF)')); return; }
      if (!code) { respond('No authorization code returned.'); finish(new Error('no code in redirect')); return; }
      respond('Connected.');
      finish(null, { code });
    });

    function finish(error, value) {
      if (finished) return;
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      setImmediate(() => { try { server.close(); } catch (_) { /* already closing */ } });
      if (error) settle.reject(error); else settle.resolve(value);
    }

    server.on('error', (e) => { if (!finished) rejectStart(e); });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}${path}`;
      timer = setTimeout(() => finish(new Error(`timed out waiting for OAuth redirect after ${timeoutMs}ms`)), timeoutMs);
      if (timer.unref) timer.unref();
      resolveStart({
        redirectUri,
        waitForCode: () => done,
        close: () => { if (!finished) { finished = true; try { server.close(); } catch (_) {} } },
      });
    });
  });
}

module.exports = { startLoopbackServer };
