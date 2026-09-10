import type { DocumentInfo, WireError } from '../src/protocol.js';

export function currentDocument(): DocumentInfo {
  return {
    name: figma.root.name.slice(0, 500),
    fileKey: null,
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name.slice(0, 500),
    selection: figma.currentPage.selection.slice(0, 500).map(node => ({
      id: node.id, name: node.name.slice(0, 500), type: node.type
    })),
    selectionCount: figma.currentPage.selection.length
  };
}

export class PluginError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: WireError['details']) {
    super(message);
  }
}

export async function resolveNodes(nodeIds?: string[]): Promise<SceneNode[]> {
  if (!nodeIds) {
    const selection = [...figma.currentPage.selection];
    if (selection.length === 0) throw new PluginError('EMPTY_SELECTION', 'Select a layer in Figma, or supply nodeIds.');
    return selection;
  }
  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') {
      throw new PluginError('NODE_NOT_FOUND', `Scene node ${id} was not found.`);
    }
    nodes.push(node);
  }
  return nodes;
}
