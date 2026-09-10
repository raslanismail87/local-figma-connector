import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mutate } from '../plugin/mutations.js';

const mixed = Symbol('mixed');
const future = () => Date.now() + 10000;
function setup() {
  const nodes = new Map<string, any>();
  const fonts: FontName[] = [];
  let undoBoundaries = 0;
  let creates = 0;
  const page: any = { id: 'page', type: 'PAGE', parent: null, selection: [], appendChild(node: any) { node.parent = page; } };
  const shape = (id: string, type = 'RECTANGLE', extra: Record<string, unknown> = {}) => {
    const node: any = {
      id, type, name: id, parent: page, width: 100, height: 80, x: 0, y: 0,
      visible: true, opacity: 1, fills: [], strokes: [], strokeWeight: 1,
      layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
      resize(width: number, height: number) { node.width = width; node.height = height; }, ...extra
    };
    nodes.set(id, node);
    return node;
  };
  const text = (id: string, extra: Record<string, unknown> = {}) => shape(id, 'TEXT', {
    characters: 'Hello', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14,
    lineHeight: { unit: 'AUTO' }, textAutoResize: 'HEIGHT',
    getRangeAllFontNames: () => [], ...extra
  });
  nodes.set(page.id, page);
  const api = {
    mixed, currentPage: page,
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    loadFontAsync: async (font: FontName) => { fonts.push(font); },
    commitUndo: () => { undoBoundaries++; },
    createRectangle: () => { creates++; return shape(`new-${creates}`); },
    createText: () => { creates++; return text(`new-${creates}`); }
  };
  Object.assign(globalThis, { figma: api });
  return { api, page, shape, text, fonts, get undoBoundaries() { return undoBoundaries; }, get creates() { return creates; } };
}

test('preflight rejects unsupported properties and invalid parents without creating nodes', async () => {
  const env = setup();
  await assert.rejects(mutate({ operation: 'create', params: { type: 'RECTANGLE', properties: { characters: 'no' }, select: true } }, future()), {
    code: 'UNSUPPORTED_PROPERTY', details: { nodeId: null, created: false, appliedProperties: [], partial: false, inspectBeforeRetry: false }
  });
  env.shape('instance', 'INSTANCE');
  await assert.rejects(mutate({ operation: 'create', params: { type: 'RECTANGLE', parentId: 'instance', properties: {}, select: false } }, future()), { code: 'INVALID_PARENT' });
  assert.equal(env.creates, 0);
  assert.equal(env.undoBoundaries, 0);
});

test('unsupported GROUP update is rejected before mutation with a certain unchanged outcome', async () => {
  const env = setup();
  const group = env.shape('group', 'GROUP');
  await assert.rejects(mutate({ operation: 'update', params: { nodeId: 'group', properties: { name: 'Renamed' } } }, future()), {
    code: 'UNSUPPORTED_NODE_TYPE', details: { nodeId: 'group', created: false, appliedProperties: [], partial: false, inspectBeforeRetry: false }
  });
  assert.equal(group.name, 'group');
  assert.equal(env.undoBoundaries, 0);
});

test('create applies dimensions and solid colors, selects the node, and isolates undo', async () => {
  const env = setup();
  const result = await mutate({ operation: 'create', params: { type: 'RECTANGLE', properties: { name: 'Accent', width: 200, fills: [{ r: 1, g: 0, b: 0, a: 0.4 }] }, select: true } }, future());
  const node = env.page.selection[0];
  assert.equal(result.nodeId, node.id);
  assert.equal(result.created, true);
  assert.equal(node.width, 200);
  assert.equal(node.height, 80);
  assert.deepEqual(node.fills, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.4 }]);
  assert.equal(env.undoBoundaries, 2);
});

test('mixed text update loads every existing font and requested font before changing text', async () => {
  const env = setup();
  const first = { family: 'Inter', style: 'Regular' };
  const second = { family: 'Inter', style: 'Bold' };
  const replacement = { family: 'Roboto', style: 'Regular' };
  const node = env.text('text', { fontName: mixed, getRangeAllFontNames: () => [first, second, first] });
  let content = 'Hello';
  Object.defineProperty(node, 'characters', { get: () => content, set: value => { assert.deepEqual(env.fonts, [first, second, replacement]); content = value; } });
  await mutate({ operation: 'update', params: { nodeId: 'text', properties: { font: replacement, characters: 'Updated', fontSize: 20 } } }, future());
  assert.equal(node.characters, 'Updated');
  assert.equal(node.textAutoResize, 'HEIGHT');
  assert.equal(node.width, 100);
  assert.equal(env.undoBoundaries, 2);
});

test('font failure and expiration during async font loading prevent all edits', async () => {
  const env = setup();
  const node = env.text('text');
  env.api.loadFontAsync = async () => { throw new Error('Font missing'); };
  await assert.rejects(mutate({ operation: 'update', params: { nodeId: 'text', properties: { characters: 'Changed' } } }, future()), { code: 'FONT_UNAVAILABLE' });
  const realNow = Date.now;
  Date.now = () => 100;
  try {
    env.api.loadFontAsync = async () => { Date.now = () => 300; };
    await assert.rejects(mutate({ operation: 'update', params: { nodeId: 'text', properties: { characters: 'Changed' } } }, 200), { code: 'REQUEST_EXPIRED' });
  } finally { Date.now = realNow; }
  assert.equal(node.characters, 'Hello');
  assert.equal(env.undoBoundaries, 0);
});

test('setter failure reports partial outcome and closes the undo boundary without rolling back', async () => {
  const env = setup();
  const node = env.shape('rect');
  Object.defineProperty(node, 'opacity', { get: () => 1, set: () => { throw new Error('Read-only override'); } });
  await assert.rejects(mutate({ operation: 'update', params: { nodeId: 'rect', properties: { name: 'Renamed', opacity: 0.5 } } }, future()), {
    code: 'FIGMA_MUTATION_FAILED', details: { nodeId: 'rect', created: false, appliedProperties: ['name'], partial: true, inspectBeforeRetry: true }
  });
  assert.equal(node.name, 'Renamed');
  assert.equal(env.undoBoundaries, 2);
});

test('new text uses Inter Regular and preserves its default text resizing mode', async () => {
  const env = setup();
  await mutate({ operation: 'create', params: { type: 'TEXT', properties: { characters: 'Label' }, select: true } }, future());
  assert.deepEqual(env.fonts, [{ family: 'Inter', style: 'Regular' }]);
  assert.deepEqual(env.page.selection[0].fontName, { family: 'Inter', style: 'Regular' });
  assert.equal(env.page.selection[0].textAutoResize, 'HEIGHT');
});

test('FILL sizing requires an Auto Layout parent before any property is changed', async () => {
  const env = setup();
  const node = env.shape('rect');
  await assert.rejects(mutate({ operation: 'update', params: { nodeId: 'rect', properties: { name: 'Changed', layoutSizingHorizontal: 'FILL' } } }, future()), { code: 'INVALID_LAYOUT' });
  assert.equal(node.name, 'rect');
  assert.equal(env.undoBoundaries, 0);
});
