import { exportResultSchema, type Command } from '../src/protocol.js';
import { PluginError, resolveNodes } from './document.js';

type ExportParams = Extract<Command, { operation: 'export' }>['params'];
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;

export async function exportNodes(params: ExportParams) {
  const nodes = await resolveNodes(params.nodeIds);
  if (nodes.length > 5) throw new PluginError('EXPORT_LIMIT', 'Export at most five nodes per request.');
  const exports = [];
  let totalBytes = 0;
  for (const node of nodes) {
    const bounds = ('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null) ?? node.absoluteBoundingBox;
    const width = Math.ceil((bounds?.width ?? node.width) * params.scale);
    const height = Math.ceil((bounds?.height ?? node.height) * params.scale);
    if (width * height > MAX_PIXELS || width > 16384 || height > 16384) {
      throw new PluginError('EXPORT_TOO_LARGE', `Node ${node.id} exceeds the export pixel limit; reduce scale or select a smaller node.`);
    }
    const bytes = await node.exportAsync(params.format === 'PNG'
      ? { format: 'PNG', constraint: { type: 'SCALE', value: params.scale } }
      : { format: 'SVG' });
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_EXPORT_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new PluginError('EXPORT_TOO_LARGE', 'Export exceeds the byte limit; export fewer nodes or use a smaller scale.');
    }
    exports.push({
      nodeId: node.id, name: node.name.slice(0, 500), format: params.format,
      mimeType: params.format === 'PNG' ? 'image/png' : 'image/svg+xml',
      width: params.format === 'PNG' ? width : node.width,
      height: params.format === 'PNG' ? height : node.height,
      scale: params.format === 'PNG' ? params.scale : 1,
      base64: figma.base64Encode(bytes)
    });
  }
  return exportResultSchema.parse({ exports });
}
