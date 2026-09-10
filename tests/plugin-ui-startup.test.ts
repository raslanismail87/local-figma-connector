import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
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
    value: string; textContent: string; disabled: boolean; dataset: Record<string, string>;
    listeners: Map<string, Listener>; addEventListener: (name: string, callback: Listener) => void;
    click: () => void;
  }>();
  for (const selector of ['#token', '#connect', '#disconnect', '#status', '#document', '#dot']) {
    const listeners = new Map<string, Listener>();
    elements.set(selector, {
      value: '', textContent: '', disabled: false, dataset: {}, listeners,
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
    parent, top, WebSocket: FakeSocket, setTimeout, clearTimeout
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
  assert.deepEqual(relayed, [{ pluginMessage: { type: 'ready' } }]);
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
  assert.equal(ui.randomnessCalls, 1);
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
  assert.deepEqual(ui.relayed[1], { pluginMessage: request });
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
