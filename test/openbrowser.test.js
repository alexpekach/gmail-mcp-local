'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resolveOpenCommand } = require('../src/oauth/openBrowser');

// Regression: the OAuth URL contains `&` between query params. The old
// `cmd /c start "" <url>` launcher let cmd interpret `&` as a command separator,
// truncating the URL at the first param → Google rejected it with
// "Required parameter is missing: response_type". The launcher must NOT use cmd
// and must pass the URL through as a single, unmodified argv element.
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=X&response_type=code&scope=a+b&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Foauth2%2Fcallback';

test('win32 launcher avoids cmd and passes the URL verbatim (no & truncation)', () => {
  const { cmd, args } = resolveOpenCommand('win32', OAUTH_URL);
  assert.strictEqual(cmd, 'rundll32');
  assert.ok(!/cmd/i.test(cmd), 'must not route through cmd');
  assert.ok(args.includes('url.dll,FileProtocolHandler'));
  assert.strictEqual(args[args.length - 1], OAUTH_URL, 'URL passed as one untouched arg');
});

test('darwin and linux open the URL as a single arg', () => {
  assert.deepStrictEqual(resolveOpenCommand('darwin', OAUTH_URL), { cmd: 'open', args: [OAUTH_URL] });
  assert.deepStrictEqual(resolveOpenCommand('linux', OAUTH_URL), { cmd: 'xdg-open', args: [OAUTH_URL] });
});
