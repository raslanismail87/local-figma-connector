import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readNodes } from '../plugin/read.js';
import { exportNodes } from '../plugin/export.js';

const mixed = Symbol('mixed');
const sceneNode = (id: string, extras: Record<string, unknown> = {}) => ({
  id, name: id, type: 'RECTANGLE', visible: true, locked: false,
  x: 0, y: 0, width: 100, height: 80, parent: { id: 'page' },
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
  absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 80 },
  relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  exportAsync: async () => new Uint8Array([1, 2, 3]), ...extras
});

function installFigma(selection: ReturnType<typeof sceneNode>[]) {
  Object.assign(globalThis, { figma: {
    mixed, root: { name: 'Test file' }, fileKey: undefined,
    currentPage: { id: 'page', name: 'Page 1', selection },
    getNodeByIdAsync: async (id: string) => selection.find(node => node.id === id) ?? null,
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  } });
}

test('read shares the hierarchy node budget across roots and safely describes mixed text', async () => {
  const text = sceneNode('text', { type: 'TEXT', characters: 'Hello world', fontSize: mixed });
  installFigma([sceneNode('frame', { type: 'FRAME', children: [text, sceneNode('extra')] }), sceneNode('other-root')]);
  const result = await readNodes({ depth: 3, maxNodes: 2, maxTextLength: 5 }) as Record<string, any>;
  assert.equal(result.nodeCount, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].childrenTruncated, true);
  assert.equal(result.nodes[0].children[0].fontSize, 'MIXED');
  assert.equal(result.nodes[0].children[0].characters, 'Hello');
  assert.equal(result.nodes[0].children[0].charactersTruncated, true);
});

test('read reports children omitted at requested depth', async () => {
  installFigma([sceneNode('frame', { type: 'FRAME', children: [sceneNode('child')] })]);
  const result = await readNodes({ depth: 0, maxNodes: 10, maxTextLength: 10 }) as Record<string, any>;
  assert.equal(result.nodes[0].childCount, 1);
  assert.deepEqual(result.nodes[0].children, []);
  assert.equal(result.nodes[0].childrenTruncated, true);
});

test('empty selection and missing explicit nodes produce actionable errors', async () => {
  installFigma([]);
  await assert.rejects(readNodes({ depth: 1, maxNodes: 10, maxTextLength: 10 }), { code: 'EMPTY_SELECTION' });
  await assert.rejects(exportNodes({ format: 'PNG', scale: 1, nodeIds: ['missing'] }), { code: 'NODE_NOT_FOUND' });
});

test('PNG exports are encoded and use the requested scale', async () => {
  let settings: unknown;
  installFigma([sceneNode('image', { exportAsync: async (value: unknown) => { settings = value; return new Uint8Array([1, 2, 3]); } })]);
  const result = await exportNodes({ format: 'PNG', scale: 2 });
  assert.deepEqual(settings, { format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  assert.equal(result.exports[0].base64, 'AQID');
  assert.equal(result.exports[0].width, 200);
  assert.equal(result.exports[0].height, 160);
});

test('export pixel bounds reject oversized work before invoking Figma', async () => {
  let called = false;
  installFigma([sceneNode('huge', { absoluteRenderBounds: { width: 9000, height: 9000 }, exportAsync: async () => { called = true; return new Uint8Array(); } })]);
  await assert.rejects(exportNodes({ format: 'PNG', scale: 1 }), { code: 'EXPORT_TOO_LARGE' });
  assert.equal(called, false);
});

test('export enforces the aggregate byte limit across nodes', async () => {
  const bytes = new Uint8Array(6 * 1024 * 1024);
  installFigma([sceneNode('one', { exportAsync: async () => bytes }), sceneNode('two', { exportAsync: async () => bytes })]);
  await assert.rejects(exportNodes({ format: 'SVG', scale: 1 }), { code: 'EXPORT_TOO_LARGE' });
});
