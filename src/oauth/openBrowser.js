'use strict';

const { spawn } = require('node:child_process');

/**
 * Resolve the OS command to open a URL in the default browser.
 *
 * Windows: use `rundll32 url.dll,FileProtocolHandler <url>` — spawned DIRECTLY
 * (no shell). The old `cmd /c start "" <url>` path was broken: cmd treats the
 * `&` between OAuth query params as a command separator and truncates the URL at
 * the first `&`, so Google only saw `client_id` and rejected the request with
 * "Required parameter is missing: response_type". rundll32 receives the URL as a
 * single argv element, so `&`, `%`, `+` etc. pass through verbatim.
 *
 * Pure + exported so the regression is unit-testable without launching anything.
 */
function resolveOpenCommand(platform, url) {
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/**
 * Open a URL in the user's default browser. Injectable — tests pass a fake, so
 * this real implementation is never exercised under test.
 */
function openBrowser(url) {
  const { cmd, args } = resolveOpenCommand(process.platform, url);
  return new Promise((resolve, reject) => {
    try {
      // No `detached` on Windows — a detached + stdio:'ignore' child can trip a
      // libuv handle-teardown assertion on quick process exit. The launcher
      // (rundll32/open/xdg-open) hands off to the browser and exits fast; unref
      // so it never blocks our own exit.
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('error', reject);
      child.unref();
      resolve();
    } catch (e) { reject(e); }
  });
}

module.exports = { openBrowser, resolveOpenCommand };
