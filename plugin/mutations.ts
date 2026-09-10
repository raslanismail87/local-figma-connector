import { createParamsSchema, type Command, type WireError } from '../src/protocol.js';
import { PluginError, resolveNodes } from './document.js';
import { applyProperties, createNode, loadMutationFonts, validateProperties } from './properties.js';

type Mutation = Extract<Command, { operation: 'create' | 'update' }>;
type Parent = PageNode | FrameNode | GroupNode | ComponentNode | SectionNode | ComponentSetNode;

async function resolveParent(id: string | undefined, type: string): Promise<Parent> {
  const parent = id ? await figma.getNodeByIdAsync(id) : figma.currentPage;
  if (!parent) throw new PluginError('NODE_NOT_FOUND', `Parent ${id} was not found.`);
  if (!['PAGE', 'FRAME', 'GROUP', 'COMPONENT', 'SECTION', 'COMPONENT_SET'].includes(parent.type)) {
    throw new PluginError('INVALID_PARENT', `Cannot create a layer inside ${parent.type}.`);
  }
  if (parent.type === 'COMPONENT_SET' && type !== 'COMPONENT') {
    throw new PluginError('INVALID_PARENT', 'A component set accepts only components.');
  }
  if (type === 'COMPONENT') {
    for (let ancestor: BaseNode | null = parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type === 'COMPONENT' || ancestor.type === 'INSTANCE') {
        throw new PluginError('INVALID_PARENT', 'A main component cannot be nested inside a component or instance.');
      }
    }
  }
  return parent as Parent;
}

function checkDeadline(expiresAt: number) {
  if (Date.now() >= expiresAt) throw new PluginError('REQUEST_EXPIRED', 'The request expired before any edit was made.');
}

export async function mutate(command: Mutation, expiresAt: number) {
  let node: SceneNode | undefined;
  let mutationStarted = false;
  let created = false;
  let failure: unknown;
  const applied: string[] = [];
  try {
    checkDeadline(expiresAt);
    let parent: Parent | undefined;
    if (command.operation === 'create') {
      parent = await resolveParent(command.params.parentId, command.params.type);
      if (command.params.select && findPage(parent) !== figma.currentPage) {
        throw new PluginError('INVALID_SELECTION', 'Creating on another page requires select:false, or switching to that page first.');
      }
      validateProperties(command.params.type, command.params.properties, parent);
      await loadMutationFonts(command.params.properties, undefined, command.params.type);
    } else {
      [node] = await resolveNodes([command.params.nodeId]);
      if (!createParamsSchema.shape.type.safeParse(node.type).success) {
        throw new PluginError('UNSUPPORTED_NODE_TYPE', `Updates to ${node.type} nodes are not supported. Supported types: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, POLYGON, STAR, COMPONENT.`);
      }
      validateProperties(node.type, command.params.properties, node.parent, node);
      await loadMutationFonts(command.params.properties, node);
    }
    checkDeadline(expiresAt);
    figma.commitUndo();
    mutationStarted = true;
    if (command.operation === 'create') {
      node = createNode(command.params.type);
      created = true;
      parent!.appendChild(node);
      applied.push('parentId');
      if (node.type === 'TEXT') {
        node.fontName = { family: 'Inter', style: 'Regular' };
        applied.push('font');
      }
    }
    applyProperties(node!, command.params.properties, applied);
    if (command.operation === 'create' && command.params.select) {
      const page = findPage(node!);
      if (page === figma.currentPage) {
        figma.currentPage.selection = [node!];
        applied.push('selection');
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (mutationStarted) {
      try { figma.commitUndo(); } catch (error) { failure ??= error; }
    }
  }
  if (failure) {
    const details: WireError['details'] = {
      nodeId: node?.id ?? (command.operation === 'update' ? command.params.nodeId : null),
      created, appliedProperties: [...new Set(applied)],
      partial: created || applied.length > 0,
      inspectBeforeRetry: mutationStarted
    };
    throw new PluginError(
      failure instanceof PluginError ? failure.code : 'FIGMA_MUTATION_FAILED',
      (failure instanceof Error ? failure.message : String(failure)).slice(0, 2000), details
    );
  }
  return { nodeId: node!.id, type: node!.type, name: node!.name.slice(0, 500), created, appliedProperties: [...new Set(applied)] };
}

function findPage(node: BaseNode): PageNode | undefined {
  let ancestor: BaseNode | null = node;
  while (ancestor && ancestor.type !== 'PAGE') ancestor = ancestor.parent;
  return ancestor?.type === 'PAGE' ? ancestor : undefined;
}
