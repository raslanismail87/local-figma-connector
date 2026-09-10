import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PairingStorage } from '../plugin/pairing-storage.js';
import { pairingRequestSchema } from '../plugin/pairing-protocol.js';

const token = 'a'.repeat(64);
const request = (action: 'load' | 'save' | 'forget') => pairingRequestSchema.parse({ type: 'pairing', requestId: randomUUID(), action, ...(action === 'save' ? { token } : {}) });

test('pairing storage serializes save and forget, and preserves pairing across plugin launches', async () => {
  let value: unknown;
  let finishSave!: () => void;
  const storage = {
    getAsync: async () => value,
    setAsync: async (_key: string, next: unknown) => { await new Promise<void>(resolve => { finishSave = resolve; }); value = next; },
    deleteAsync: async () => { value = undefined; }
  };
  const pairing = new PairingStorage(storage, 'test-plugin');
  const saving = pairing.handle(request('save'));
  const forgetting = pairing.handle(request('forget'));
  await Promise.resolve();
  finishSave();
  assert.equal((await saving).ok, true);
  assert.equal((await forgetting).ok, true);
  const empty = await new PairingStorage(storage, 'test-plugin').handle(request('load'));
  assert.ok(empty.ok && empty.action === 'load');
  assert.equal(empty.token, null);
  value = token;
  const restored = await new PairingStorage(storage, 'test-plugin').handle(request('load'));
  assert.ok(restored.ok && restored.action === 'load');
  assert.equal(restored.token, token);
});

test('pairing storage removes corrupt values and reports failures without including secrets', async () => {
  let deleted = false;
  const corrupt = new PairingStorage({ getAsync: async () => ({ token }), setAsync: async () => {}, deleteAsync: async () => { deleted = true; } }, 'test-plugin');
  const result = await corrupt.handle(request('load'));
  assert.ok(result.ok && result.action === 'load');
  assert.equal(result.token, null);
  assert.equal(deleted, true);
  const fail = async () => { throw new Error(token); };
  const broken = new PairingStorage({ getAsync: fail, setAsync: fail, deleteAsync: fail }, 'test-plugin');
  for (const action of ['load', 'save', 'forget'] as const) {
    const result = await broken.handle(request(action));
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
  }
});

test('pairing control requests strictly restrict token handling and correlation', () => {
  for (const invalid of [
    { type: 'pairing', action: 'save', requestId: randomUUID(), token: 'invalid' },
    { type: 'pairing', action: 'forget', requestId: randomUUID(), token },
    { type: 'pairing', action: 'load', requestId: 'not-a-uuid' },
    { type: 'pairing', action: 'save', requestId: randomUUID(), token, extra: true }
  ]) assert.equal(pairingRequestSchema.safeParse(invalid).success, false);
});

test('unregistered development plugins receive an actionable error without touching storage', async () => {
  let touched = false;
  const pairing = new PairingStorage({
    getAsync: async () => { touched = true; },
    setAsync: async () => { touched = true; },
    deleteAsync: async () => { touched = true; }
  }, undefined);
  for (const action of ['load', 'save', 'forget'] as const) {
    const result = await pairing.handle(request(action));
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.error, 'PAIRING_ID_REQUIRED');
  }
  assert.equal(touched, false);
});
