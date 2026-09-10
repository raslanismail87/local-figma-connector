import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { settings } from '../src/config.js';
import { findChromeExecutable } from '../src/platform/chrome.js';

const executable = await findChromeExecutable();
const endpoint = 'http://127.0.0.1:9222';
const profile = join(settings().stateDir, 'chrome-profile');
await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error('Port 9222 is already in use. Close the dedicated debug Chrome before launching another instance.')));
  probe.listen(9222, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
});
await mkdir(profile, { recursive: true, mode: 0o700 });
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check', 'https://www.figma.com/'], { detached: true, stdio: 'ignore' });
chrome.once('error', error => { process.stderr.write(`Chrome could not start: ${error.message}\n`); process.exitCode = 1; });
chrome.unref();
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500), redirect: 'error' });
    if (response.ok) {
      process.stdout.write(`${JSON.stringify({ endpoint, profile, pid: chrome.pid, instructions: 'Log in to Figma in this dedicated Chrome profile. Add FIGMA_CONNECTOR_CDP_URL=http://127.0.0.1:9222 to the MCP environment and restart it. Close this Chrome window to stop the debugging browser.' }, null, 2)}\n`);
      process.exit(0);
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
throw new Error('Chrome was started but its local debugging endpoint was not ready within 15 seconds. Inspect the dedicated Chrome window.');
