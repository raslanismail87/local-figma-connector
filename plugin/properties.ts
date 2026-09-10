import type { Command, NodeProperties } from '../src/protocol.js';
import { PluginError } from './document.js';

type CreateType = Extract<Command, { operation: 'create' }>['params']['type'];
const textProperties = new Set(['characters', 'font', 'fontSize', 'textAlignHorizontal', 'textAutoResize', 'lineHeight', 'letterSpacing']);
const frameTypes = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET']);
const cornerTypes = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR']);

export function validateProperties(type: string, properties: NodeProperties, parent: BaseNode | null, node?: SceneNode) {
  for (const key of Object.keys(properties)) {
    const actualKey = key === 'font' ? 'fontName' : key;
    const supported = key === 'autoLayout' ? frameTypes.has(type)
      : key === 'clipsContent' ? frameTypes.has(type)
      : key === 'cornerRadius' ? cornerTypes.has(type)
      : textProperties.has(key) ? type === 'TEXT'
      : node ? actualKey in node : true;
    if (!supported) throw new PluginError('UNSUPPORTED_PROPERTY', `${key} is not supported on ${type}.`);
  }
  if ((properties.width !== undefined || properties.height !== undefined) && node && !('resize' in node)) {
    throw new PluginError('UNSUPPORTED_PROPERTY', `Resizing is not supported on ${type}.`);
  }
  for (const axis of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const) {
    const sizing = properties[axis];
    if (sizing === 'FILL' && (!parent || !('layoutMode' in parent) || parent.layoutMode === 'NONE')) {
      throw new PluginError('INVALID_LAYOUT', `${axis} FILL requires an Auto Layout parent.`);
    }
    const layoutMode = properties.autoLayout?.layoutMode ?? (node && 'layoutMode' in node ? node.layoutMode : 'NONE');
    if (sizing === 'HUG' && type !== 'TEXT' && (!frameTypes.has(type) || layoutMode === 'NONE')) {
      throw new PluginError('INVALID_LAYOUT', `${axis} HUG requires text or an Auto Layout container.`);
    }
  }
}

export function createNode(type: CreateType): SceneNode {
  switch (type) {
    case 'FRAME': return figma.createFrame();
    case 'TEXT': return figma.createText();
    case 'RECTANGLE': return figma.createRectangle();
    case 'ELLIPSE': return figma.createEllipse();
    case 'LINE': return figma.createLine();
    case 'POLYGON': return figma.createPolygon();
    case 'STAR': return figma.createStar();
    case 'COMPONENT': return figma.createComponent();
  }
}

export async function loadMutationFonts(properties: NodeProperties, node?: SceneNode, newType?: CreateType) {
  if (node?.type !== 'TEXT' && newType !== 'TEXT') return;
  const fonts: FontName[] = [];
  if (node?.type === 'TEXT') {
    if (node.fontName === figma.mixed) fonts.push(...node.getRangeAllFontNames(0, node.characters.length));
    else fonts.push(node.fontName);
  } else fonts.push({ family: 'Inter', style: 'Regular' });
  if (properties.font) fonts.push(properties.font);
  const unique = new Map(fonts.map(font => [JSON.stringify(font), font]));
  try {
    for (const font of unique.values()) await figma.loadFontAsync(font);
  } catch (error) {
    throw new PluginError('FONT_UNAVAILABLE', `A required font could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function applyProperties(node: SceneNode, properties: NodeProperties, applied: string[]) {
  const target = node as unknown as Record<string, unknown>;
  const assign = (key: string, value: unknown, reportedKey = key) => {
    target[key] = value;
    applied.push(reportedKey);
  };
  if (properties.font) assign('fontName', properties.font, 'font');
  if (properties.characters !== undefined) assign('characters', properties.characters);
  const deferred = new Set(['font', 'characters', 'width', 'height', 'autoLayout', 'layoutSizingHorizontal', 'layoutSizingVertical', 'x', 'y']);
  for (const [key, value] of Object.entries(properties)) {
    if (deferred.has(key)) continue;
    if (key === 'fills' || key === 'strokes') {
      const paints: SolidPaint[] = (value as NonNullable<NodeProperties['fills']>).map(({ r, g, b, a }) => ({ type: 'SOLID', color: { r, g, b }, opacity: a ?? 1 }));
      assign(key, paints);
    } else assign(key, value);
  }
  if (properties.width !== undefined || properties.height !== undefined) {
    if (!('resize' in node)) throw new PluginError('UNSUPPORTED_PROPERTY', `Resizing is not supported on ${node.type}.`);
    node.resize(properties.width ?? node.width, properties.height ?? node.height);
    if (properties.width !== undefined) applied.push('width');
    if (properties.height !== undefined) applied.push('height');
  }
  if (properties.autoLayout) {
    const { layoutMode, ...rest } = properties.autoLayout;
    if (layoutMode !== undefined) assign('layoutMode', layoutMode, 'autoLayout.layoutMode');
    for (const [key, value] of Object.entries(rest)) assign(key, value, `autoLayout.${key}`);
  }
  for (const key of ['layoutSizingHorizontal', 'layoutSizingVertical', 'x', 'y'] as const) {
    if (properties[key] !== undefined) assign(key, properties[key]);
  }
}
