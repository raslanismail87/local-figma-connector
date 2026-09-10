import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createParamsSchema, exportParamsSchema, idSchema, readParamsSchema, requestIdSchema, responseSchema, updateParamsSchema, type Command } from '../protocol.js';
import { ConnectorError, wireError } from '../errors.js';
import { BridgeClient } from '../bridge/client.js';
import { exportContent } from './exports.js';

export function createMcpServer(bridge: BridgeClient, exportDir: string) {
  const server = new McpServer({ name: 'local-figma-connector', version: '1.0.0' });
  const target = { sessionId: idSchema.optional().describe('Explicit connected session ID; required when more than one plugin is connected.') };
  const mutation = { mutationId: requestIdSchema.describe('Fresh UUID for a new intended mutation. Reuse this exact UUID and arguments only to retrieve a known attempt. Never automatically retry after uncertainty with a fresh UUID.') };
  const text = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { result: data } });
  const safe = async (action: () => Promise<CallToolResult>): Promise<CallToolResult> => { try { return await action(); } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(wireError(error)) }] }; } };
  const execute = async (sessionId: string | undefined, command: Command, requestId: string = randomUUID()) => {
    const response = responseSchema.parse(await bridge.call({ method: 'execute', sessionId, requestId, command }));
    if (response.requestId !== requestId) throw new ConnectorError('INVALID_CORRELATION', 'Bridge response does not match this request. Inspect mutation status before retrying.', { requestId });
    if (!response.ok) throw new ConnectorError(response.error.code, response.error.message, { ...response.error.details, requestId });
    return { requestId, data: response.data };
  };
  server.registerTool('figma_sessions', { description: 'List connected local Figma plugins with session IDs, document/page names and latest selection. File keys are unavailable through the public Plugin API and returned as null. Pair in Figma desktop if empty.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false } }, async () => safe(async () => text(await bridge.call({ method: 'sessions' }))));
  server.registerTool('figma_selection', { description: 'Read the current selection and document from the live plugin.', inputSchema: z.object(target).strict(), annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ sessionId }) => safe(async () => text(await execute(sessionId, { operation: 'selection', params: {} }))));
  server.registerTool('figma_read_nodes', { description: 'Read specified nodes or current selection with bounded hierarchy, geometry, fills, text, typography and Auto Layout. Mixed values and truncation are explicit.', inputSchema: readParamsSchema.extend(target), annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ sessionId, ...params }) => safe(async () => text(await execute(sessionId, { operation: 'read', params }))));
  server.registerTool('figma_export_nodes', { description: 'Export specified nodes or selection as PNG preview images or SVG files, with local paths and metadata. Maximum five nodes; plugin enforces export size limits.', inputSchema: exportParamsSchema.extend(target), annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ sessionId, ...params }) => safe(async () => exportContent((await execute(sessionId, { operation: 'export', params })).data, exportDir)));
  server.registerTool('figma_create_node', { description: 'Create one frame, text, shape or component using the Plugin API. Dimensions use pixels and colors use 0–1 channels. Font defaults to Inter Regular for new text. Creates an undo boundary. Read failures for partial/uncertain outcomes.', inputSchema: createParamsSchema.extend({ ...target, ...mutation }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ sessionId, mutationId, ...params }) => safe(async () => text(await execute(sessionId, { operation: 'create', params }, mutationId))));
  server.registerTool('figma_update_node', { description: 'Update supported typed properties on one existing frame, text, basic shape or component. Preloads fonts and rejects unsupported properties. Updates may partially apply if Figma rejects a property; inspect returned node ID and use Figma Undo. Never automatically replay an uncertain mutation.', inputSchema: updateParamsSchema.extend({ ...target, ...mutation }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ sessionId, mutationId, ...params }) => safe(async () => text(await execute(sessionId, { operation: 'update', params }, mutationId))));
  server.registerTool('figma_request_status', { description: 'Inspect the durable status and result of a previously submitted mutation UUID, including late responses after timeout. Unknown status is not proof that a mutation did not happen.', inputSchema: z.object({ requestId: requestIdSchema }).strict(), annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ requestId }) => safe(async () => text(await bridge.call({ method: 'request_status', requestId }))));
  return server;
}
