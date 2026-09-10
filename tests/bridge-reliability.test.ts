import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeFixture, errorCode, mutation, nextRequest, rejectRequest, respondSelection, selection } from './bridge-fixture.js';

test('multiple sessions require explicit targeting; wrong socket and ID cannot complete a request', async t => {
  const bridge = await bridgeFixture(t, { timeoutMs: 100 });
  const first = await bridge.connect();
  const second = await bridge.connect();
  await assert.rejects(bridge.client.call({ method: 'execute', requestId: randomUUID(), command: selection }), errorCode('SESSION_REQUIRED'));
  const requestId = randomUUID();
  const incoming = nextRequest(first.socket);
  const result = bridge.client.call({ method: 'execute', sessionId: first.sessionId, requestId, command: selection });
  const rejected = assert.rejects(result, errorCode('TIMEOUT'));
  assert.equal((await incoming).requestId, requestId);
  respondSelection(second.socket, requestId);
  respondSelection(first.socket, randomUUID());
  await rejected;
  const followupId = randomUUID();
  const followupIncoming = nextRequest(second.socket);
  const followup = bridge.client.call({ method: 'execute', sessionId: second.sessionId, requestId: followupId, command: selection });
  assert.equal((await followupIncoming).requestId, followupId);
  respondSelection(second.socket, followupId);
  assert.equal((await followup as { ok: boolean }).ok, true);
});

test('read disconnects fail immediately and mutation disconnects retain uncertain status', async t => {
  const bridge = await bridgeFixture(t);
  for (const command of [selection, mutation]) {
    const peer = await bridge.connect();
    const requestId = randomUUID();
    const incoming = nextRequest(peer.socket);
    const result = bridge.client.call({ method: 'execute', sessionId: peer.sessionId, requestId, command });
    const rejected = assert.rejects(result, errorCode(command.operation === 'selection' ? 'DISCONNECTED' : 'OUTCOME_UNCERTAIN'));
    await incoming;
    peer.socket.terminate();
    await rejected;
    if (command.operation === 'create') {
      const status = await bridge.client.call({ method: 'request_status', requestId }) as { state: string };
      assert.equal(status.state, 'uncertain');
    } else {
      await assert.rejects(bridge.client.call({ method: 'request_status', requestId }), errorCode('REQUEST_NOT_FOUND'));
    }
  }
});

test('a timed-out mutation remains blocked until its late response is retained', async t => {
  const bridge = await bridgeFixture(t, { timeoutMs: 100 });
  const peer = await bridge.connect();
  const requestId = randomUUID();
  const rpc = { method: 'execute' as const, sessionId: peer.sessionId, requestId, command: mutation };
  const incoming = nextRequest(peer.socket);
  const rejected = assert.rejects(bridge.client.call(rpc), errorCode('OUTCOME_UNCERTAIN'));
  await incoming;
  await rejected;
  assert.equal((await bridge.client.call({ method: 'request_status', requestId }) as { state: string }).state, 'uncertain');
  await assert.rejects(bridge.client.call(rpc), errorCode('OUTCOME_UNCERTAIN'));
  await assert.rejects(bridge.client.call({ ...rpc, requestId: randomUUID() }), errorCode('SESSION_BUSY'));
  rejectRequest(peer.socket, requestId);
  const fenceId = randomUUID();
  const fenceIncoming = nextRequest(peer.socket);
  const fence = bridge.client.call({ method: 'execute', requestId: fenceId, sessionId: peer.sessionId, command: selection });
  await fenceIncoming;
  respondSelection(peer.socket, fenceId);
  await fence;
  const status = await bridge.client.call({ method: 'request_status', requestId }) as { state: string; response: { error: { code: string } } };
  assert.equal(status.state, 'completed');
  assert.equal(status.response.error.code, 'FIXTURE_REJECTED');
  assert.deepEqual(await bridge.client.call(rpc), status.response);
});

test('duplicate mutation IDs retain exact results without replay and conflict with changed arguments', async t => {
  const bridge = await bridgeFixture(t);
  const peer = await bridge.connect();
  let dispatched = 0;
  peer.socket.on('message', raw => { if (JSON.parse(raw.toString()).type === 'request') dispatched++; });
  const requestId = randomUUID();
  const rpc = { method: 'execute' as const, requestId, sessionId: peer.sessionId, command: mutation };
  const incoming = nextRequest(peer.socket);
  const result = bridge.client.call(rpc);
  await incoming;
  await assert.rejects(bridge.client.call(rpc), errorCode('OUTCOME_UNCERTAIN'));
  rejectRequest(peer.socket, requestId);
  const response = await result;
  assert.deepEqual(await bridge.client.call(rpc), response);
  await assert.rejects(bridge.client.call({ ...rpc, command: { ...mutation, params: { ...mutation.params, properties: { name: 'Different' } } } }), errorCode('REQUEST_ID_CONFLICT'));
  await assert.rejects(bridge.client.call({ ...rpc, sessionId: randomUUID() }), errorCode('REQUEST_ID_CONFLICT'));
  assert.equal(dispatched, 1);
});

test('reconnecting the same plugin instance replaces its session and invalidates in-flight reads', async t => {
  const bridge = await bridgeFixture(t);
  const original = await bridge.connect();
  const incoming = nextRequest(original.socket);
  const result = bridge.client.call({ method: 'execute', requestId: randomUUID(), sessionId: original.sessionId, command: selection });
  const rejected = assert.rejects(result, errorCode('DISCONNECTED'));
  await incoming;
  const closed = once(original.socket, 'close');
  const replacement = await bridge.connect(original.instanceId);
  await rejected;
  await closed;
  const listed = await bridge.client.call({ method: 'sessions' }) as { sessions: { id: string }[] };
  assert.deepEqual(listed.sessions.map(session => session.id), [replacement.sessionId]);
  await assert.rejects(bridge.client.call({ method: 'execute', requestId: randomUUID(), sessionId: original.sessionId, command: selection }), errorCode('NOT_CONNECTED'));
});

test('persisted uncertain and completed mutation IDs cannot replay after a bridge restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-ledger-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, 'mutations.json');
  const first = await bridgeFixture(t, { ledgerPath, timeoutMs: 100 });
  const peer = await first.connect();
  const completedId = randomUUID();
  let incoming = nextRequest(peer.socket);
  const completedRpc = { method: 'execute' as const, requestId: completedId, command: mutation };
  const completed = first.client.call(completedRpc);
  await incoming;
  rejectRequest(peer.socket, completedId);
  const completedResponse = await completed;
  const uncertainId = randomUUID();
  const uncertainRpc = { ...completedRpc, requestId: uncertainId };
  incoming = nextRequest(peer.socket);
  const uncertain = assert.rejects(first.client.call(uncertainRpc), errorCode('OUTCOME_UNCERTAIN'));
  await incoming;
  await uncertain;
  await first.close();
  const restarted = await bridgeFixture(t, { ledgerPath });
  const replacement = await restarted.connect();
  let dispatched = 0;
  replacement.socket.on('message', raw => { if (JSON.parse(raw.toString()).type === 'request') dispatched++; });
  assert.deepEqual(await restarted.client.call(completedRpc), completedResponse);
  await assert.rejects(restarted.client.call(uncertainRpc), errorCode('OUTCOME_UNCERTAIN'));
  assert.equal((await restarted.client.call({ method: 'request_status', requestId: uncertainId }) as { state: string }).state, 'uncertain');
  assert.equal(dispatched, 0);
});

test('invalid operation results fail reads and leave mutations uncertain until a valid late response', async t => {
  const bridge = await bridgeFixture(t);
  const peer = await bridge.connect();
  for (const command of [selection, mutation]) {
    const requestId = randomUUID();
    const incoming = nextRequest(peer.socket);
    const rpc = { method: 'execute' as const, requestId, sessionId: peer.sessionId, command };
    const rejected = assert.rejects(bridge.client.call(rpc), errorCode(command.operation === 'create' ? 'OUTCOME_UNCERTAIN' : 'INVALID_PLUGIN_RESPONSE'));
    await incoming;
    peer.socket.send(JSON.stringify({ type: 'response', requestId, ok: true, data: null }));
    await rejected;
    if (command.operation !== 'create') continue;
    assert.equal((await bridge.client.call({ method: 'request_status', requestId }) as { state: string }).state, 'uncertain');
    await assert.rejects(bridge.client.call(rpc), errorCode('OUTCOME_UNCERTAIN'));
    const data = { nodeId: '1:2', type: 'RECTANGLE', name: 'Fixture', created: true, appliedProperties: ['name'] };
    peer.socket.send(JSON.stringify({ type: 'response', requestId, ok: true, data }));
    const fenceId = randomUUID();
    const fenceIncoming = nextRequest(peer.socket);
    const fence = bridge.client.call({ method: 'execute', requestId: fenceId, sessionId: peer.sessionId, command: selection });
    await fenceIncoming;
    respondSelection(peer.socket, fenceId);
    await fence;
    assert.equal((await bridge.client.call({ method: 'request_status', requestId }) as { state: string }).state, 'completed');
    assert.deepEqual((await bridge.client.call(rpc) as { data: unknown }).data, data);
  }
});
