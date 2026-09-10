import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { startBridge } from '../src/bridge/server.js';
import { BridgeClient } from '../src/bridge/client.js';
import type { PluginRequest } from '../src/protocol.js';

export const document = { name: 'Bridge fixture', fileKey: null, pageId: '0:1', pageName: 'Page 1', selection: [], selectionCount: 0 };
export const selection = { operation: 'selection' as const, params: {} };
export const mutation = { operation: 'create' as const, params: { type: 'RECTANGLE' as const, properties: { name: 'Fixture' }, select: false } };

export async function bridgeFixture(t: TestContext, options: { timeoutMs?: number; ledgerPath?: string } = {}) {
  const token = randomBytes(32).toString('hex');
  const bridge = await startBridge({ token, port: 0, ...options });
  const url = `http://127.0.0.1:${bridge.port}`;
  const client = new BridgeClient(url, token);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await bridge.close(); } };
  t.after(close);
  const connect = async (instanceId = randomUUID()) => {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/plugin`);
    await once(socket, 'open');
    const paired = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'hello', version: 1, token, instanceId, document }));
    const message = JSON.parse((await paired)[0].toString());
    assert.equal(message.type, 'paired');
    return { socket, sessionId: message.sessionId as string, instanceId };
  };
  return { ...bridge, token, url, client, connect, close };
}

export async function nextRequest(socket: WebSocket): Promise<PluginRequest> {
  const [raw] = await once(socket, 'message', { signal: AbortSignal.timeout(3000) });
  const message = JSON.parse(raw.toString());
  assert.equal(message.type, 'request');
  return message;
}

export function rejectRequest(socket: WebSocket, requestId: string) {
  socket.send(JSON.stringify({ type: 'response', requestId, ok: false, error: { code: 'FIXTURE_REJECTED', message: 'Fixture deliberately rejected this operation.' } }));
}

export function respondSelection(socket: WebSocket, requestId: string) {
  socket.send(JSON.stringify({ type: 'response', requestId, ok: true, data: document }));
}

export const errorCode = (code: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, code);
  return true;
};
