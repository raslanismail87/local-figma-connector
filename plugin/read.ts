import type { Command } from '../src/protocol.js';
import { currentDocument, resolveNodes } from './document.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ReadParams = Extract<Command, { operation: 'read' }>['params'];
type Budget = { remaining: number; truncated: boolean };

function serializable(value: unknown): Json {
  if (value === figma.mixed) return 'MIXED';
  if (value === undefined || typeof value === 'symbol') return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

function inspectNode(node: SceneNode, depth: number, params: ReadParams, budget: Budget): Json {
  budget.remaining--;
  const data: Record<string, Json> = {
    id: node.id, name: node.name.slice(0, 500), type: node.type,
    parentId: node.parent?.id ?? null,
    visible: node.visible, locked: node.locked,
    x: node.x, y: node.y, width: node.width, height: node.height,
    absoluteBoundingBox: serializable(node.absoluteBoundingBox),
    absoluteRenderBounds: serializable('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null),
    relativeTransform: serializable(node.relativeTransform),
    absoluteTransform: serializable(node.absoluteTransform)
  };
  const properties = [
    'rotation', 'opacity', 'fills', 'strokes', 'strokeWeight', 'cornerRadius',
    'clipsContent', 'layoutMode', 'itemSpacing', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems', 'counterAxisAlignItems',
    'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal',
    'layoutSizingVertical', 'layoutAlign', 'layoutGrow', 'layoutPositioning',
    'fontName', 'fontSize', 'fontWeight', 'textAlignHorizontal', 'textAlignVertical',
    'textAutoResize', 'lineHeight', 'letterSpacing', 'paragraphSpacing',
    'textCase', 'textDecoration'
  ];
  for (const key of properties) {
    if (key in node) data[key] = serializable((node as unknown as Record<string, unknown>)[key]);
  }
  if (node.type === 'TEXT') {
    data.characters = node.characters.slice(0, params.maxTextLength);
    data.charactersLength = node.characters.length;
    data.charactersTruncated = node.characters.length > params.maxTextLength;
  }
  if ('children' in node) {
    data.childCount = node.children.length;
    const children: Json[] = [];
    if (depth > 0) {
      for (const child of node.children) {
        if (budget.remaining === 0) { budget.truncated = true; break; }
        children.push(inspectNode(child, depth - 1, params, budget));
      }
    }
    data.children = children;
    data.childrenTruncated = children.length < node.children.length;
  }
  return data;
}

export async function readNodes(params: ReadParams): Promise<Json> {
  const nodes = await resolveNodes(params.nodeIds);
  const budget: Budget = { remaining: params.maxNodes, truncated: false };
  const results: Json[] = [];
  for (const node of nodes) {
    if (budget.remaining === 0) { budget.truncated = true; break; }
    results.push(inspectNode(node, params.depth, params, budget));
  }
  return {
    document: serializable(currentDocument()), nodes: results,
    nodeCount: params.maxNodes - budget.remaining, truncated: budget.truncated,
    limits: { depth: params.depth, maxNodes: params.maxNodes, maxTextLength: params.maxTextLength }
  };
}
