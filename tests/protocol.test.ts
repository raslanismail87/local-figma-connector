import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandSchema, rpcSchema } from '../src/protocol.js';

test('command allowlist excludes arbitrary code and rejects unsupported or non-finite properties', () => {
  for (const input of [
    { operation: 'eval', params: { code: 'figma.createRectangle()' } },
    { operation: 'create', params: { type: 'RECTANGLE', properties: { name: 'Test', code: 'unsupported' } } },
    { operation: 'create', params: { type: 'RECTANGLE', properties: { width: Infinity } } },
    { operation: 'create', params: { type: 'RECTANGLE', properties: { opacity: NaN } } },
    { operation: 'update', params: { nodeId: '1:1', properties: {} } },
    { operation: 'update', params: { nodeId: '1:1', properties: { font: { family: 'Inter', style: 'Regular', source: '/tmp/custom.ttf' } } } }
  ]) assert.equal(commandSchema.safeParse(input).success, false);
});

test('read, export, and mutation inputs enforce traversal and payload bounds', () => {
  for (const params of [{ depth: 11 }, { maxNodes: 501 }, { maxTextLength: 20001 }, { nodeIds: [] }, { nodeIds: Array(51).fill('1:1') }]) {
    assert.equal(commandSchema.safeParse({ operation: 'read', params }).success, false);
  }
  for (const params of [{ nodeIds: Array(6).fill('1:1') }, { scale: 4.1 }, { format: 'PDF' }]) {
    assert.equal(commandSchema.safeParse({ operation: 'export', params }).success, false);
  }
  assert.equal(commandSchema.safeParse({ operation: 'create', params: { type: 'TEXT', properties: { characters: 'x'.repeat(20001) } } }).success, false);
  assert.equal(rpcSchema.safeParse({ method: 'execute', requestId: randomUUID(), command: { operation: 'read', params: {} }, retry: true }).success, false);
  assert.deepEqual(commandSchema.parse({ operation: 'read', params: {} }), { operation: 'read', params: { depth: 2, maxNodes: 100, maxTextLength: 2000 } });
});
