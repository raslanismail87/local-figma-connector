import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MutationLedger } from '../src/bridge/ledger.js';
import { bridgeFixture, errorCode, mutation } from './bridge-fixture.js';

test('pending ledger entries recover as uncertain after abrupt restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-ledger-pending-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'mutations.json');
  const requestId = randomUUID();
  const ledger = new MutationLedger(path);
  ledger.put({ requestId, fingerprint: 'fixture-fingerprint', sessionId: randomUUID(), state: 'pending', createdAt: new Date().toISOString() });
  assert.equal(JSON.parse(await readFile(path, 'utf8'))[0].state, 'pending');
  const recovered = new MutationLedger(path);
  assert.equal(recovered.get(requestId)?.state, 'uncertain');
  assert.equal(recovered.get(requestId)?.response, undefined);
});

test('a corrupt durable ledger prevents bridge startup instead of discarding duplicate protection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-ledger-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'mutations.json');
  await writeFile(path, '{truncated');
  assert.throws(() => new MutationLedger(path), errorCode('LEDGER_UNREADABLE'));
});

test('a ledger persistence failure prevents a mutation from being dispatched', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-ledger-fail-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bridge = await bridgeFixture(t, { ledgerPath: join(directory, 'missing-parent', 'mutations.json') });
  const peer = await bridge.connect();
  let dispatched = 0;
  peer.socket.on('message', () => dispatched++);
  const requestId = randomUUID();
  await assert.rejects(bridge.client.call({ method: 'execute', requestId, sessionId: peer.sessionId, command: mutation }), errorCode('LEDGER_WRITE_FAILED'));
  await assert.rejects(bridge.client.call({ method: 'request_status', requestId }), errorCode('REQUEST_NOT_FOUND'));
  assert.equal(dispatched, 0);
});
