import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerBrowserTools } from '../src/browser/tools.js';
import { findChromeExecutable } from '../src/platform/chrome.js';

const executable = await findChromeExecutable();
const profile = await mkdtemp(join(tmpdir(), 'figma-chrome-smoke-'));
const output = resolve('artifacts/chrome-smoke');
await mkdir(output, { recursive: true });
const fixture = `<!doctype html><html><head><title>Connector browser fixture</title></head><body><h1>Browser smoke fixture</h1><form><label>Name <input name="name" aria-label="Name"></label><button type="submit">Save</button></form><p role="status">Waiting</p><button id="coordinate" style="position:fixed;left:20px;top:180px;width:180px;height:40px">Coordinate action</button><script>document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('[role=status]').textContent='Saved '+document.querySelector('input').value});document.querySelector('#coordinate').addEventListener('click',()=>{document.querySelector('[role=status]').textContent='Coordinate clicked'});</script></body></html>`;
const http = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(request.url === '/next' ? '<!doctype html><title>Next fixture</title><h1>Navigation verified</h1>' : fixture);
});
http.listen(0, '127.0.0.1');
await once(http, 'listening');
const address = http.address();
assert.ok(address && typeof address !== 'string');
const fixtureOrigin = `http://127.0.0.1:${address.port}`;
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', '--window-size=1024,768', 'about:blank'], { stdio: 'ignore' });
const server = new McpServer({ name: 'chrome-smoke', version: '1.0.0' });
const client = new Client({ name: 'chrome-smoke-client', version: '1.0.0' });
let adapter: ReturnType<typeof registerBrowserTools> | undefined;
let captureBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
const checks: string[] = [];

async function readyEndpoint() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      if (/^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    } catch {}
    if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${chrome.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Temporary Chrome did not expose a CDP port.');
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
  checks.push(name);
  return result;
}

try {
  const endpoint = await readyEndpoint();
  adapter = registerBrowserTools(server, { endpoint, testFixtureOrigin: fixtureOrigin, timeoutMs: 2500 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await call('chrome_tabs');
  const version = (listed.structuredContent as { browserVersion: string }).browserVersion;
  const opened = await call('chrome_open_tab', { url: `${fixtureOrigin}/fixture` });
  const tabId = (opened.structuredContent as { tabId: string }).tabId;
  const noSelection = await client.callTool({ name: 'chrome_snapshot', arguments: {} });
  assert.equal(noSelection.isError, true);
  assert.match(JSON.stringify(noSelection.content), /CHROME_TAB_REQUIRED/);
  await call('chrome_select_tab', { tabId });
  await call('chrome_fill', { target: { role: 'textbox', name: 'Name' }, value: 'Astra' });
  await call('chrome_click', { target: { role: 'button', name: 'Save' } });
  assert.match(JSON.stringify((await call('chrome_snapshot')).content), /Saved Astra/);
  await call('chrome_fill', { target: { selector: 'input[name="name"]' }, value: 'Keyboard' });
  await call('chrome_keypress', { key: 'Enter' });
  assert.match(JSON.stringify((await call('chrome_snapshot')).content), /Saved Keyboard/);
  await call('chrome_click', { target: { x: 80, y: 200 } });
  assert.match(JSON.stringify((await call('chrome_snapshot')).content), /Coordinate clicked/);
  const screenshot = await call('chrome_screenshot');
  const image = (screenshot.content as { type: string; data?: string }[]).find(item => item.type === 'image');
  assert.ok(image?.data);
  const png = Buffer.from(image.data, 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await writeFile(join(output, 'browser-fixture.png'), png);
  const failed = await client.callTool({ name: 'chrome_click', arguments: { target: { role: 'button', name: 'Missing button' } } });
  assert.equal(failed.isError, true);
  assert.match(JSON.stringify(failed.content), /CHROME_ACTION_UNCERTAIN/);
  assert.match(JSON.stringify(failed.content), /timeout/);
  checks.push('uncertain click timeout');
  const truncated = await call('chrome_snapshot', { maxCharacters: 100 });
  assert.equal((truncated.structuredContent as { truncated: boolean }).truncated, true);
  await call('chrome_navigate', { url: `${fixtureOrigin}/next` });
  assert.match(JSON.stringify((await call('chrome_snapshot')).content), /Navigation verified/);
  const afterNavigation = await call('chrome_tabs');
  assert.ok((afterNavigation.structuredContent as { tabs: { tabId: string }[] }).tabs.some(tab => tab.tabId === tabId));
  checks.push('stable tab ID after navigation');
  const rejected = await client.callTool({ name: 'chrome_navigate', arguments: { url: 'https://example.com' } });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /CHROME_URL_REJECTED/);
  checks.push('off-domain navigation rejected');
  captureBrowser = await chromium.connectOverCDP(endpoint);
  const preview = await captureBrowser.contexts()[0].newPage();
  await preview.setViewportSize({ width: 320, height: 340 });
  const html = await readFile('plugin/ui.html', 'utf8');
  await preview.setContent(html);
  await preview.screenshot({ path: join(output, 'pairing-ui.png') });
  const longError = html.replace('<span id="status">Disconnected</span>', '<span id="status">Pairing rejected. The saved token does not match the running bridge. Run npm run pair, paste the current token, and connect again.</span>').replace('<span id="dot" aria-hidden="true">', '<span id="dot" data-state="error" aria-hidden="true">').replace('Waiting for the current file…', 'A long document title for the connector verification / A long page name · 3 selected');
  await preview.setContent(longError);
  await preview.screenshot({ path: join(output, 'pairing-ui-long-error.png'), fullPage: true });
  checks.push('320x340 pairing UI and long error visual fixtures');
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, browserVersion: version, checks, scope: 'Real installed Chrome over CDP through in-memory MCP tools against a temporary localhost fixture. Pairing screenshots are static visual fixtures. This does not validate Figma login, the Figma-hosted plugin iframe, or actual document mutations.', artifacts: output }, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: true, browserVersion: version, checks, artifacts: output }, null, 2)}\n`);
} finally {
  await client.close();
  await server.close();
  await captureBrowser?.close();
  await adapter?.disconnect();
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]); }
  if (chrome.exitCode === null) chrome.kill('SIGKILL');
  await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
