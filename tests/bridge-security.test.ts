import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import WebSocket from 'ws';
import { MAX_MESSAGE_BYTES } from '../src/protocol.js';
import { bridgeFixture, document } from './bridge-fixture.js';

test('HTTP requires the exact token, numeric loopback Host, and no browser Origin', async t => {
  const bridge = await bridgeFixture(t);
  for (const authorization of [undefined, `Bearer ${'0'.repeat(64)}`, 'Bearer short', `Bearer ${'é'.repeat(64)}`]) {
    const response = await fetch(`${bridge.url}/health`, { headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  }
  for (const host of ['attacker.example', `localhost:${bridge.port}`]) {
    for (const path of ['/health', '/rpc']) {
      const forbiddenHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${bridge.url}${path}`, { method: path === '/rpc' ? 'POST' : 'GET', headers: { host, authorization: `Bearer ${bridge.token}` } }, response => {
          response.resume();
          resolve(response.statusCode);
        });
        req.on('error', reject);
        req.end(path === '/rpc' ? JSON.stringify({ method: 'sessions' }) : undefined);
      });
      assert.equal(forbiddenHostStatus, 403, `${path} must reject Host ${host}`);
    }
  }
  const forbiddenHeaders: Record<string, string>[] = [{ origin: 'https://www.figma.com' }, { origin: 'null' }];
  for (const headers of forbiddenHeaders) {
    const response = await fetch(`${bridge.url}/health`, { headers: { authorization: `Bearer ${bridge.token}`, ...headers } });
    assert.equal(response.status, 403);
  }
  const healthy = await fetch(`${bridge.url}/health`, { headers: { authorization: `Bearer ${bridge.token}` } });
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).sessions, 0);
});

test('HTTP rejects invalid JSON, unknown methods, unknown fields, and oversized requests', async t => {
  const bridge = await bridgeFixture(t);
  for (const body of ['{', '{"method":"eval"}', '{"method":"sessions","code":"evil"}', '{"method":"execute","requestId":"bad"}']) {
    const response = await fetch(`${bridge.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_MESSAGE');
  }
  const response = await fetch(`${bridge.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: ' '.repeat(256 * 1024 + 1) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'MESSAGE_TOO_LARGE');
});

test('WebSocket rejects a foreign Origin and a forged Host before pairing', async t => {
  const bridge = await bridgeFixture(t);
  for (const options of [
    { origin: 'https://attacker.example' },
    { headers: { host: 'attacker.example' } },
    { headers: { host: `localhost.attacker.example:${bridge.port}` } },
    { headers: { host: `localhost:${bridge.port === 65535 ? 65534 : bridge.port + 1}` } }
  ]) {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/plugin`, options);
    await once(socket, 'error');
    assert.notEqual(socket.readyState, WebSocket.OPEN);
  }
  assert.deepEqual(await bridge.client.call({ method: 'sessions' }), { sessions: [] });
});

test('the plugin can pair through a localhost WebSocket with the Figma sandbox Origin', async t => {
  const bridge = await bridgeFixture(t);
  const socket = new WebSocket(`ws://localhost:${bridge.port}/plugin`, { family: 4, origin: 'null' });
  await once(socket, 'open');
  const paired = once(socket, 'message', { signal: AbortSignal.timeout(3000) });
  const instanceId = randomUUID();
  socket.send(JSON.stringify({ type: 'hello', version: 1, token: bridge.token, instanceId, document }));
  const message = JSON.parse((await paired)[0].toString());
  assert.equal(message.type, 'paired');
  const result = await bridge.client.call({ method: 'sessions' }) as { sessions: { id: string; instanceId: string; document: unknown }[] };
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, message.sessionId);
  assert.equal(result.sessions[0].instanceId, instanceId);
  assert.deepEqual(result.sessions[0].document, document);
});

test('WebSocket rejects malformed, unauthenticated, and out-of-order messages', async t => {
  const bridge = await bridgeFixture(t);
  const badMessages = [
    '{',
    JSON.stringify({ type: 'document', document }),
    JSON.stringify({ type: 'hello', version: 1, token: '0'.repeat(64), instanceId: randomUUID(), document }),
    JSON.stringify({ type: 'hello', version: 2, token: bridge.token, instanceId: randomUUID(), document }),
    JSON.stringify({ type: 'hello', version: 1, token: bridge.token, instanceId: randomUUID(), document, code: 'unsupported' })
  ];
  for (const message of badMessages) {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/plugin`);
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send(message);
    assert.equal((await closed)[0], 1008);
  }
  assert.deepEqual(await bridge.client.call({ method: 'sessions' }), { sessions: [] });
});

test('WebSocket enforces a byte payload limit and the bridge stays available', async t => {
  const bridge = await bridgeFixture(t);
  const { socket } = await bridge.connect();
  const closed = once(socket, 'close');
  socket.send(' '.repeat(MAX_MESSAGE_BYTES + 1));
  assert.equal((await closed)[0], 1009);
  const healthy = await fetch(`${bridge.url}/health`, { headers: { authorization: `Bearer ${bridge.token}` } });
  assert.equal(healthy.status, 200);
  assert.ok((await bridge.connect()).sessionId);
});
