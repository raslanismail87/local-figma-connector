import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Response } from '../src/protocol.js';

test('sandbox executes mutations once, rejects expired requests, and survives a failed UI delivery', async () => {
  const responses: Response[] = [];
  let createCount = 0;
  let failDelivery = true;
  const page: any = { id: 'page', name: 'Page 1', type: 'PAGE', parent: null, selection: [], appendChild(node: any) { node.parent = page; } };
  const api = {
    root: { name: 'Runtime test' }, currentPage: page, fileKey: undefined,
    showUI: () => {}, on: () => {}, commitUndo: () => {},
    ui: {
      onmessage: undefined as undefined | ((message: unknown) => void),
      postMessage: (message: any) => {
        if (message.type !== 'response') return;
        if (failDelivery) { failDelivery = false; throw new Error('UI temporarily unavailable'); }
        responses.push(message);
      }
    },
    createRectangle: () => ({ id: `created-${++createCount}`, type: 'RECTANGLE', name: 'Rectangle', parent: page })
  };
  Object.assign(globalThis, { figma: api, __html__: '' });
  await import('../plugin/main.js');
  const request = (requestId: string, expiresAt = Date.now() + 10000) => ({
    type: 'request', requestId, expiresAt,
    command: { operation: 'create', params: { type: 'RECTANGLE', properties: {}, select: false } }
  });
  const firstId = '00000000-0000-4000-8000-000000000001';
  api.ui.onmessage!(request(firstId));
  api.ui.onmessage!(request(firstId));
  api.ui.onmessage!(request('00000000-0000-4000-8000-000000000002', Date.now() - 1));
  api.ui.onmessage!(request('00000000-0000-4000-8000-000000000003'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(createCount, 2);
  assert.equal(responses.length, 3);
  assert.equal(responses[0].ok, false);
  assert.equal(!responses[0].ok && responses[0].error.code, 'DUPLICATE_MUTATION');
  assert.equal(!responses[1].ok && responses[1].error.code, 'REQUEST_EXPIRED');
  assert.equal(responses[2].ok, true);
});
