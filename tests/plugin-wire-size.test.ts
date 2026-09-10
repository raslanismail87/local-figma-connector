import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MESSAGE_BYTES, type Response } from '../src/protocol.js';
import { boundedResponse, MAX_OUTGOING_BYTES, serializeWithinLimit, utf8ByteLength } from '../plugin/wire-size.js';

test('sandbox UTF-8 sizing matches encoded bytes for ASCII, CJK, emoji, and lone surrogates', () => {
  for (const text of ['plain ASCII', '你好世界', '💜🎨', '\ud800', '\udfff', 'aé世💜z']) {
    assert.equal(utf8ByteLength(text), Buffer.byteLength(text));
    assert.equal(utf8ByteLength(JSON.stringify(text)), Buffer.byteLength(JSON.stringify(text)));
  }
  assert.equal(serializeWithinLimit({ value: '你好' }), '{"value":"你好"}');
  assert.equal(serializeWithinLimit('x'.repeat(MAX_OUTGOING_BYTES)), undefined);
});

test('UI response guard replaces oversized Unicode data with a correlated actionable error', () => {
  const response: Response = { type: 'response', requestId: '00000000-0000-4000-8000-000000000001', ok: true, data: '界'.repeat(Math.ceil(MAX_MESSAGE_BYTES / 3)) };
  const bounded = boundedResponse(response);
  assert.equal(bounded.requestId, response.requestId);
  assert.equal(!bounded.ok && bounded.error.code, 'RESPONSE_TOO_LARGE');
  assert.ok(serializeWithinLimit(bounded));
});

test('oversized CJK read emits READ_TOO_LARGE and the following sandbox request still succeeds', async () => {
  const responses: Response[] = [];
  const content = '界'.repeat(20000);
  const texts = Array.from({ length: 499 }, (_, index) => ({
    id: `text-${index}`, name: `Text ${index}`, type: 'TEXT', characters: content,
    x: 0, y: 0, width: 100, height: 80, visible: true, locked: false,
    absoluteBoundingBox: null, relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]]
  }));
  const frame = { id: 'frame', name: 'Frame', type: 'FRAME', children: texts, x: 0, y: 0, width: 100, height: 80, visible: true, locked: false };
  const api = {
    root: { name: 'Unicode file' }, currentPage: { id: 'page', name: 'Page 1', selection: [frame] },
    showUI: () => {}, on: () => {},
    ui: {
      onmessage: undefined as undefined | ((message: unknown) => void),
      postMessage: (message: any) => {
        if (message.type !== 'response') return;
        assert.ok(Buffer.byteLength(JSON.stringify(message)) < MAX_MESSAGE_BYTES);
        responses.push(message);
      }
    }
  };
  Object.assign(globalThis, { figma: api, __html__: '' });
  await import('../plugin/main.js');
  api.ui.onmessage!({ type: 'request', requestId: '00000000-0000-4000-8000-000000000002', expiresAt: Date.now() + 10000, command: { operation: 'read', params: { depth: 1, maxNodes: 500, maxTextLength: 20000 } } });
  api.ui.onmessage!({ type: 'request', requestId: '00000000-0000-4000-8000-000000000003', expiresAt: Date.now() + 10000, command: { operation: 'selection', params: {} } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses.length, 2);
  assert.equal(!responses[0].ok && responses[0].error.code, 'READ_TOO_LARGE');
  assert.equal(responses[1].ok, true);
});
