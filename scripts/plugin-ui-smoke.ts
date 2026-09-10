import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { WebSocketServer } from 'ws';
import { startBridge } from '../src/bridge/server.js';
import { BridgeClient } from '../src/bridge/client.js';
import { documentSchema, pluginMessageSchema, responseSchema } from '../src/protocol.js';
import { findChromeExecutable } from '../src/platform/chrome.js';

const output = resolve('artifacts/plugin-ui-smoke');
const executable = await findChromeExecutable();
const token = randomBytes(32).toString('hex');
const wrongToken = randomBytes(32).toString('hex');
const fixtureDocument = documentSchema.parse({ name: 'Connector UI relay fixture', fileKey: null, pageId: '0:1', pageName: 'UI validation', selection: [{ id: '1:1', name: 'Selected fixture rectangle', type: 'RECTANGLE' }], selectionCount: 1 });
const sourceHtml = await readFile('dist/plugin/ui.html', 'utf8');
assert.ok(sourceHtml.includes('npm run bridge'), 'Rebuild after the current pairing UI instructions are updated.');
assert.ok(sourceHtml.includes('ws://localhost:3845/plugin'), 'Expected compiled production WebSocket endpoint.');
await mkdir(output, { recursive: true });
let bridge: Awaited<ReturnType<typeof startBridge>> | undefined = await startBridge({ token, port: 0, timeoutMs: 5000 });
const bridgePort = bridge.port;
const bridgeClient = new BridgeClient(`http://127.0.0.1:${bridgePort}`, token);
const html = sourceHtml.split('ws://localhost:3845/plugin').join(`ws://localhost:${bridgePort}/plugin`);
const parentScript = await build({ stdin: { contents: `
import { requestSchema, documentSchema } from './src/protocol.js';
const info = documentSchema.parse(${JSON.stringify(fixtureDocument)});
window.fixtureState = { ready: 0, selections: 0, rejected: 0, messages: [] };
window.addEventListener('message', event => {
  const frame = document.querySelector('iframe');
  if (event.source !== frame?.contentWindow) return;
  const message = event.data?.pluginMessage;
  window.fixtureState.messages.push(JSON.stringify(message));
  if (message?.type === 'ready') {
    window.fixtureState.ready++;
    frame.contentWindow.postMessage({ pluginMessage: { type: 'document', document: info } }, '*');
    return;
  }
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success || parsed.data.expiresAt < Date.now() || parsed.data.command.operation !== 'selection') {
    window.fixtureState.rejected++;
    return;
  }
  window.fixtureState.selections++;
  frame.contentWindow.postMessage({ pluginMessage: { type: 'response', requestId: parsed.data.requestId, ok: true, data: info } }, '*');
});`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020' });
const wrapper = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><script>${parentScript.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script><iframe title="Plugin UI fixture" sandbox="allow-scripts" src="/ui"></iframe></body></html>`;
const http = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Cache-Control', 'no-store');
  response.end(request.url === '/ui' ? html : wrapper);
});
http.listen(0, '127.0.0.1');
await once(http, 'listening');
const address = http.address();
assert.ok(address && typeof address !== 'string');
const profile = await mkdtemp(join(tmpdir(), 'figma-plugin-ui-smoke-'));
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let browser: Browser | undefined;
let errorServer: WebSocketServer | undefined;
const checks: string[] = [];

async function waitUntil(check: () => Promise<boolean>, label: string, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

async function sessions() {
  return (await bridgeClient.call({ method: 'sessions' }) as { sessions: { id: string; instanceId: string; document: unknown }[] }).sessions;
}

try {
  let endpoint = '';
  await waitUntil(async () => {
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      if (!/^\d+$/.test(port)) return false;
      endpoint = `http://127.0.0.1:${port}`;
      return true;
    } catch { return false; }
  }, 'temporary Chrome CDP endpoint');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const urls: string[] = [];
  page.on('pageerror', error => { pageErrors.push(error.message); process.stderr.write(`Fixture page error: ${error.message}\n`); });
  page.on('request', request => urls.push(request.url()));
  page.on('websocket', socket => urls.push(socket.url()));
  await page.setViewportSize({ width: 320, height: 380 });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
  page.setDefaultTimeout(8000);
  const ui = page.frameLocator('iframe');
  await ui.locator('#document').filter({ hasText: fixtureDocument.name }).waitFor({ timeout: 5000 });
  assert.equal(await ui.locator('#status').textContent(), 'Disconnected');
  const frame = page.frames().find(candidate => candidate.url().endsWith('/ui'))!;
  assert.equal(await frame.evaluate(() => isSecureContext && typeof crypto.randomUUID === 'function'), true);
  checks.push('compiled UI initialized in allow-scripts-only opaque-origin sandbox with real parent ready/document handshake');
  await page.screenshot({ path: join(output, 'disconnected-320.png') });
  await ui.getByRole('button', { name: 'Connect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: 'Paste the 64-character token' }).waitFor();
  assert.equal((await sessions()).length, 0);
  checks.push('empty token rejected before connection');
  await ui.getByLabel('Pairing token', { exact: true }).fill(wrongToken);
  await ui.getByRole('button', { name: 'Connect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: 'Pairing rejected' }).waitFor();
  assert.equal(await ui.getByLabel('Pairing token', { exact: true }).inputValue(), '');
  assert.equal((await sessions()).length, 0);
  await page.screenshot({ path: join(output, 'invalid-token-320.png') });
  checks.push('incorrect 64-character token rejected by real bridge; input and session cleared');
  await ui.getByLabel('Pairing token', { exact: true }).fill(token);
  await ui.getByLabel('Pairing token', { exact: true }).press('Enter');
  await ui.locator('#status').filter({ hasText: 'Connected · ready for Codex' }).waitFor();
  assert.equal(await ui.getByLabel('Pairing token', { exact: true }).inputValue(), '');
  assert.equal(await ui.getByLabel('Pairing token', { exact: true }).isDisabled(), true);
  const [firstSession] = await sessions();
  assert.ok(firstSession);
  assert.deepEqual(firstSession.document, fixtureDocument);
  const response = responseSchema.parse(await bridgeClient.call({ method: 'execute', sessionId: firstSession.id, requestId: randomUUID(), command: { operation: 'selection', params: {} } }));
  assert.equal(response.ok, true);
  if (response.ok) assert.deepEqual(response.data, fixtureDocument);
  checks.push('Enter-key pairing with real authenticated bridge session and selection RPC → compiled UI → validated simulated parent → UI → bridge response');
  await page.screenshot({ path: join(output, 'connected-320.png') });
  await page.setViewportSize({ width: 280, height: 380 });
  await page.screenshot({ path: join(output, 'connected-280.png') });
  await page.setViewportSize({ width: 320, height: 380 });
  await bridge.close();
  bridge = undefined;
  await ui.locator('#status').filter({ hasText: 'Bridge unavailable' }).waitFor();
  await page.screenshot({ path: join(output, 'bridge-unavailable-320.png') });
  bridge = await startBridge({ token, port: bridgePort, timeoutMs: 5000 });
  await ui.locator('#status').filter({ hasText: 'Connected · ready for Codex' }).waitFor({ timeout: 10000 });
  const [restartedSession] = await sessions();
  assert.equal(restartedSession.instanceId, firstSession.instanceId);
  assert.notEqual(restartedSession.id, firstSession.id);
  const resumed = responseSchema.parse(await bridgeClient.call({ method: 'execute', sessionId: restartedSession.id, requestId: randomUUID(), command: { operation: 'selection', params: {} } }));
  assert.equal(resumed.ok, true);
  checks.push('automatic reconnect after real bridge restart restores the same plugin instance and working relay');
  await ui.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: 'Connected · ready for Codex' }).waitFor();
  await waitUntil(async () => { const current = await sessions(); return current.length === 1 && current[0].id !== restartedSession.id; }, 'manual reconnect creates one replacement session');
  checks.push('manual reconnect uses in-memory token and replaces the prior session');
  await ui.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: /^Disconnected$/ }).waitFor();
  await waitUntil(async () => (await sessions()).length === 0, 'disconnect removes bridge session');
  assert.equal(await ui.getByLabel('Pairing token', { exact: true }).inputValue(), '');
  await ui.getByRole('button', { name: 'Connect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: 'Paste the 64-character token' }).waitFor();
  checks.push('disconnect clears session and in-memory token; reconnect requires a fresh token');
  const storageState = await context.storageState();
  assert.equal(JSON.stringify(storageState).includes(token), false);
  assert.equal(urls.some(url => url.includes(token) || url.includes(wrongToken)), false);
  const frameStorage = await frame.evaluate(() => {
    try { return { available: true, contents: JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }) }; }
    catch { return { available: false, contents: '' }; }
  });
  assert.equal(frameStorage.available, false);
  const parentState = await page.evaluate(() => (window as unknown as { fixtureState: { ready: number; selections: number; rejected: number; messages: string[] } }).fixtureState);
  assert.equal(parentState.ready, 1);
  assert.equal(parentState.selections, 2);
  assert.equal(parentState.rejected, 0);
  assert.equal(parentState.messages.some(message => message.includes(token) || message.includes(wrongToken)), false);
  checks.push('pairing token absent from URLs, browser storage, and parent relay messages; iframe storage unavailable by sandbox');
  await bridge.close();
  bridge = undefined;
  const longMessage = 'Pairing failed. A different local bridge is running. Run npm run pair in the connector folder, paste the current token, and connect again.';
  errorServer = new WebSocketServer({ host: '127.0.0.1', port: bridgePort });
  let opaqueWebSocketOrigin = false;
  errorServer.on('connection', (socket, request) => {
    opaqueWebSocketOrigin = request.headers.origin === 'null';
    socket.on('message', raw => {
      const parsed = pluginMessageSchema.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success || parsed.data.type !== 'hello' || parsed.data.token !== token) { socket.close(1008); return; }
      socket.send(JSON.stringify({ type: 'error', error: { code: 'TEST_PAIRING_ERROR', message: longMessage } }));
    });
  });
  await once(errorServer, 'listening');
  await ui.getByLabel('Pairing token', { exact: true }).fill(token);
  await ui.getByRole('button', { name: 'Connect', exact: true }).click();
  await ui.locator('#status').filter({ hasText: longMessage }).waitFor();
  assert.equal(opaqueWebSocketOrigin, true, 'Sandboxed iframe WebSocket origin must be null.');
  assert.equal(await ui.getByLabel('Pairing token', { exact: true }).isEnabled(), true);
  assert.equal(await ui.getByRole('button', { name: 'Disconnect', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(output, 'protocol-error-320.png') });
  await page.setViewportSize({ width: 280, height: 380 });
  await page.screenshot({ path: join(output, 'protocol-error-280.png') });
  const narrowLayout = await frame.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight }));
  assert.equal(narrowLayout.scrollWidth <= narrowLayout.width, true, 'Pairing UI must not scroll horizontally at 280px.');
  assert.deepEqual(pageErrors, []);
  checks.push('actual UI renders a long validated protocol error from a test-only WebSocket peer at 320px and 280px widths');
  const result = { passed: true, browserVersion: browser.version(), checks, narrowLayout, parentRelay: { ready: parentState.ready, selections: parentState.selections, rejected: parentState.rejected }, scope: 'Actual built plugin UI script in a sandboxed Chrome iframe, real authenticated bridge, simulated schema-valid Figma parent for selection only. The long error peer is a separate test-only WebSocket server. This does not validate a real Figma-hosted iframe, document API behavior, or Chrome LNA permissions on figma.com.', artifacts: output };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (errorServer) {
    for (const socket of errorServer.clients) socket.terminate();
    await new Promise<void>(resolve => errorServer!.close(() => resolve()));
  }
  await bridge?.close();
  await browser?.close();
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]); }
  if (chrome.exitCode === null) chrome.kill('SIGKILL');
  await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
