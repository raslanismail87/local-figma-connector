import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { pluginMessageSchema } from '../src/protocol.js';

async function startUi() {
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../plugin/ui.ts', import.meta.url))], write: false,
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020',
    minifyWhitespace: true, legalComments: 'none'
  });
  type Listener = (event: any) => void;
  const elements = new Map<string, {
    value: string; textContent: string; disabled: boolean; checked: boolean; dataset: Record<string, string>;
    listeners: Map<string, Listener>; addEventListener: (name: string, callback: Listener) => void;
    click: () => void;
  }>();
  for (const selector of ['#token', '#connect', '#disconnect', '#status', '#document', '#dot', '#remember', '#forget', '#pairing-status']) {
    const listeners = new Map<string, Listener>();
    elements.set(selector, {
      value: '', textContent: '', disabled: false, checked: false, dataset: {}, listeners,
      addEventListener: (name, callback) => { listeners.set(name, callback); },
      click: () => listeners.get('click')?.({ preventDefault() {} })
    });
  }
  const relayed: unknown[] = [];
  const parent = { postMessage: (message: unknown) => { relayed.push(JSON.parse(JSON.stringify(message))); } };
  const top = {};
  const windowListeners = new Map<string, Listener>();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: unknown[] = [];
    onopen?: () => void;
    onclose?: (event: { code: number }) => void;
    onmessage?: (event: { data: string }) => void;
    constructor(public url: string) { sockets.push(this); }
    send(serialized: string) { this.sent.push(JSON.parse(serialized)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  let randomnessCalls = 0;
  runInNewContext(built.outputFiles[0].text, {
    crypto: {
      getRandomValues: (bytes: Uint8Array) => { randomnessCalls++; return webcrypto.getRandomValues(bytes); }
    },
    document: { querySelector: (selector: string) => elements.get(selector) },
    window: { addEventListener: (name: string, callback: Listener) => { windowListeners.set(name, callback); } },
    parent, top, WebSocket: FakeSocket, setTimeout: (callback: () => void, delay: number) => (nodeSetTimeout(callback, delay) as unknown as { unref(): unknown }).unref(), clearTimeout
  }, { timeout: 5000 });
  return {
    elements, relayed, parent, top, windowListeners, sockets,
    get randomnessCalls() { return randomnessCalls; },
    hostMessage(source: unknown, origin: string, pluginMessage: unknown) {
      windowListeners.get('message')!({ source, origin, data: { pluginMessage } });
    }
  };
}

test('built UI initializes without randomUUID and retains a secure UUID across reconnects', async () => {
  const ui = await startUi();
  const { elements, relayed, parent, windowListeners, sockets } = ui;
  assert.deepEqual(relayed[0], { pluginMessage: { type: 'ready' } });
  assert.equal((relayed[1] as any).pluginMessage.action, 'load');
  assert.ok(elements.get('#connect')!.listeners.has('click'));
  assert.ok(elements.get('#disconnect')!.listeners.has('click'));
  assert.ok(elements.get('#token')!.listeners.has('keydown'));
  assert.ok(windowListeners.has('message'));
  const document = { name: 'Startup test', fileKey: null, pageId: 'page', pageName: 'Page 1', selection: [], selectionCount: 0 };
  ui.hostMessage(parent, 'https://www.figma.com', { type: 'document', document });
  assert.equal(elements.get('#document')!.textContent, 'Startup test / Page 1 · 0 selected');
  elements.get('#token')!.value = 'a'.repeat(64);
  let enterPrevented = false;
  elements.get('#token')!.listeners.get('keydown')!({ key: 'Enter', preventDefault() { enterPrevented = true; } });
  assert.equal(enterPrevented, true);
  assert.equal(sockets.length, 1);
  sockets[0].open();
  const firstHello = pluginMessageSchema.parse(sockets[0].sent[0]);
  assert.equal(firstHello.type, 'hello');
  assert.ok('instanceId' in firstHello);
  assert.match(firstHello.instanceId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(elements.get('#token')!.value, '');
  elements.get('#connect')!.click();
  sockets[1].open();
  const secondHello = pluginMessageSchema.parse(sockets[1].sent[0]);
  assert.ok('instanceId' in secondHello);
  assert.equal(secondHello.instanceId, firstHello.instanceId);
  assert.equal(ui.randomnessCalls, 2);
});

test('built UI accepts its distinct Figma top window and rejects unrelated or untrusted senders', async () => {
  const ui = await startUi();
  assert.notEqual(ui.top, ui.parent);
  const document = { name: 'Initial', fileKey: null, pageId: 'page', pageName: 'Page 1', selection: [], selectionCount: 0 };
  const sendDocument = (source: unknown, origin: string, name: string) => ui.hostMessage(source, origin, { type: 'document', document: { ...document, name } });
  sendDocument(ui.parent, 'https://www.figma.com', 'Parent');
  assert.equal(ui.elements.get('#document')!.textContent, 'Parent / Page 1 · 0 selected');
  for (const origin of ['https://www.figma.com', 'https://figma.com']) {
    sendDocument(ui.top, origin, origin);
    assert.equal(ui.elements.get('#document')!.textContent, `${origin} / Page 1 · 0 selected`);
  }
  for (const [source, origin] of [
    [{}, 'https://www.figma.com'],
    [null, 'https://www.figma.com'],
    [ui.top, 'https://attacker.example'],
    [ui.top, 'https://www.figma.com.attacker.example'],
    [ui.top, 'http://www.figma.com'],
    [ui.top, 'null']
  ] as const) {
    sendDocument(source, origin, 'Untrusted');
    assert.equal(ui.elements.get('#document')!.textContent, 'https://figma.com / Page 1 · 0 selected');
  }
});

test('top-window responses require a trusted origin and an outstanding request correlation', async () => {
  const ui = await startUi();
  const document = { name: 'Correlation', fileKey: null, pageId: 'page', pageName: 'Page 1', selection: [], selectionCount: 0 };
  ui.hostMessage(ui.top, 'https://www.figma.com', { type: 'document', document });
  ui.elements.get('#token')!.value = 'a'.repeat(64);
  ui.elements.get('#connect')!.click();
  const socket = ui.sockets[0];
  assert.ok(socket);
  socket.open();
  socket.receive({ type: 'paired', sessionId: 'session' });
  const requestId = '00000000-0000-4000-8000-000000000001';
  const request = { type: 'request', requestId, expiresAt: Date.now() + 10000, command: { operation: 'selection', params: {} } };
  socket.receive(request);
  assert.deepEqual(ui.relayed[2], { pluginMessage: request });
  const response = { type: 'response', requestId, ok: true, data: document };
  ui.hostMessage(ui.top, 'https://www.figma.com', { ...response, requestId: '00000000-0000-4000-8000-000000000002' });
  ui.hostMessage({}, 'https://www.figma.com', response);
  ui.hostMessage(ui.top, 'https://attacker.example', response);
  assert.equal(socket.sent.length, 1);
  ui.hostMessage(ui.top, 'https://figma.com', response);
  assert.equal(socket.sent.length, 2);
  assert.deepEqual(socket.sent[1], response);
  ui.hostMessage(ui.top, 'https://www.figma.com', response);
  assert.equal(socket.sent.length, 2);
});

const pairingToken = 'b'.repeat(64);
const readyDocument = { name: 'Pairing', fileKey: null, pageId: 'page', pageName: 'Page 1', selection: [], selectionCount: 0 };
function pairingRequests(ui: Awaited<ReturnType<typeof startUi>>, action: string) {
  return ui.relayed.map(value => (value as any).pluginMessage).filter(value => value.type === 'pairing' && value.action === action);
}
function reply(ui: Awaited<ReturnType<typeof startUi>>, request: any, extra = {}) {
  ui.hostMessage(ui.top, 'https://www.figma.com', { type: 'pairing-result', requestId: request.requestId, action: request.action, ok: true, ...extra });
}

test('remembered pairing waits for a document and disconnect resumes without another key', async () => {
  const ui = await startUi();
  reply(ui, pairingRequests(ui, 'load')[0], { token: pairingToken });
  assert.equal(ui.elements.get('#remember')!.checked, true);
  assert.equal(ui.sockets.length, 0);
  ui.hostMessage(ui.top, 'https://www.figma.com', { type: 'document', document: readyDocument });
  const socket = ui.sockets[0];
  socket.open();
  assert.equal((socket.sent[0] as any).token, pairingToken);
  socket.receive({ type: 'paired', sessionId: 'session' });
  assert.equal(pairingRequests(ui, 'save').length, 0);
  ui.elements.get('#disconnect')!.click();
  assert.equal(pairingRequests(ui, 'forget').length, 0);
  ui.elements.get('#connect')!.click();
  ui.sockets[1].open();
  assert.equal((ui.sockets[1].sent[0] as any).token, pairingToken);
});

test('pairing is opt-in, saved after acknowledgement, and Forget clears connection and memory', async () => {
  const ui = await startUi();
  reply(ui, pairingRequests(ui, 'load')[0], { token: null });
  ui.hostMessage(ui.parent, '', { type: 'document', document: readyDocument });
  ui.elements.get('#token')!.value = pairingToken;
  ui.elements.get('#connect')!.click();
  const socket = ui.sockets[0];
  socket.open();
  socket.receive({ type: 'paired', sessionId: 'session' });
  assert.equal(pairingRequests(ui, 'save').length, 0);
  assert.equal(JSON.stringify(ui.relayed).includes(pairingToken), false);
  const remember = ui.elements.get('#remember')!;
  remember.checked = true;
  remember.listeners.get('change')!({});
  const save = pairingRequests(ui, 'save')[0];
  assert.equal(save.token, pairingToken);
  reply(ui, save);
  assert.equal(ui.elements.get('#pairing-status')!.textContent, 'Pairing saved on this computer.');
  ui.elements.get('#forget')!.click();
  assert.equal(socket.readyState, 3);
  assert.equal(remember.checked, false);
  reply(ui, pairingRequests(ui, 'forget')[0]);
  ui.elements.get('#connect')!.click();
  assert.equal(ui.sockets.length, 1);
  assert.match(ui.elements.get('#status')!.textContent, /Paste/);
});

test('late load cannot overwrite manual input or revive a forgotten pairing', async () => {
  for (const interaction of ['input', 'forget']) {
    const ui = await startUi();
    const load = pairingRequests(ui, 'load')[0];
    ui.hostMessage(ui.parent, '', { type: 'document', document: readyDocument });
    if (interaction === 'input') ui.elements.get('#token')!.listeners.get('input')!({});
    else ui.elements.get('#forget')!.click();
    reply(ui, load, { token: pairingToken });
    assert.equal(ui.sockets.length, 0);
    assert.equal(ui.elements.get('#remember')!.checked, interaction === 'input');
    if (interaction === 'input') assert.equal(ui.elements.get('#forget')!.disabled, false);
  }
});

test('unchecking Remember wins against pending save and storage errors remain actionable', async () => {
  const ui = await startUi();
  reply(ui, pairingRequests(ui, 'load')[0], { token: null });
  ui.hostMessage(ui.parent, '', { type: 'document', document: readyDocument });
  ui.elements.get('#token')!.value = pairingToken;
  const remember = ui.elements.get('#remember')!;
  remember.checked = true;
  remember.listeners.get('change')!({});
  ui.elements.get('#connect')!.click();
  assert.equal(pairingRequests(ui, 'save').length, 0);
  ui.sockets[0].open();
  ui.sockets[0].receive({ type: 'paired', sessionId: 'session' });
  const save = pairingRequests(ui, 'save')[0];
  remember.checked = false;
  remember.listeners.get('change')!({});
  reply(ui, save);
  assert.doesNotMatch(ui.elements.get('#pairing-status')!.textContent, /^Pairing saved/);
  const forget = pairingRequests(ui, 'forget')[0];
  reply(ui, forget, { ok: false, error: 'PAIRING_STORAGE_FAILED' });
  assert.match(ui.elements.get('#pairing-status')!.textContent, /Could not remove/);
  assert.equal(ui.elements.get('#forget')!.disabled, false);
  assert.equal(ui.sockets[0].readyState, 1);
  assert.equal(JSON.stringify(ui.elements.get('#pairing-status')!.textContent).includes(pairingToken), false);
});

test('rejected saved credentials are forgotten and cannot reconnect or replay requests', async () => {
  const ui = await startUi();
  reply(ui, pairingRequests(ui, 'load')[0], { token: pairingToken });
  ui.hostMessage(ui.parent, '', { type: 'document', document: readyDocument });
  ui.sockets[0].open();
  ui.sockets[0].onclose!({ code: 1008 });
  assert.equal(pairingRequests(ui, 'forget').length, 1);
  assert.match(ui.elements.get('#status')!.textContent, /Pairing rejected/);
  ui.elements.get('#connect')!.click();
  assert.equal(ui.sockets.length, 1);
});

test('saved credential responses require matching action, UUID, and trusted source', async () => {
  const ui = await startUi();
  const load = pairingRequests(ui, 'load')[0];
  const response = { type: 'pairing-result', action: 'load', requestId: load.requestId, ok: true, token: pairingToken };
  ui.hostMessage({}, 'https://www.figma.com', response);
  ui.hostMessage(ui.top, 'https://attacker.example', response);
  reply(ui, { ...load, requestId: '00000000-0000-4000-8000-000000000000' }, { token: pairingToken });
  reply(ui, { ...load, action: 'save' });
  assert.equal(ui.elements.get('#remember')!.checked, false);
  reply(ui, load, { token: pairingToken });
  assert.equal(ui.elements.get('#remember')!.checked, true);
});

test('missing development ID points users to registration instructions', async () => {
  const ui = await startUi();
  reply(ui, pairingRequests(ui, 'load')[0], { ok: false, error: 'PAIRING_ID_REQUIRED' });
  assert.equal(ui.elements.get('#pairing-status')!.textContent, 'Figma development ID required; see Remember pairing in README.');
  assert.equal(ui.sockets.length, 0);
});
