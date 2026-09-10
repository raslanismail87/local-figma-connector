import { z } from 'zod';

export const VERSION = 1;
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const idSchema = z.string().min(1).max(200);
export const requestIdSchema = z.uuid();
const finite = z.number().finite();
const size = finite.positive().max(100000);
export const colorSchema = z.object({ r: finite.min(0).max(1), g: finite.min(0).max(1), b: finite.min(0).max(1), a: finite.min(0).max(1).optional() }).strict();
export const fontSchema = z.object({ family: z.string().min(1).max(200), style: z.string().min(1).max(200) }).strict();
export const autoLayoutSchema = z.object({
  layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']).optional(),
  itemSpacing: finite.min(-1000).max(10000).optional(),
  paddingTop: finite.min(0).max(10000).optional(), paddingRight: finite.min(0).max(10000).optional(),
  paddingBottom: finite.min(0).max(10000).optional(), paddingLeft: finite.min(0).max(10000).optional(),
  primaryAxisAlignItems: z.enum(['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN']).optional(),
  counterAxisAlignItems: z.enum(['MIN', 'MAX', 'CENTER', 'BASELINE']).optional(),
  primaryAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional(),
  counterAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional()
}).strict();
export const nodePropertiesSchema = z.object({
  name: z.string().max(500).optional(), x: finite.min(-1000000).max(1000000).optional(), y: finite.min(-1000000).max(1000000).optional(),
  width: size.optional(), height: size.optional(), rotation: finite.min(-360).max(360).optional(),
  visible: z.boolean().optional(), opacity: finite.min(0).max(1).optional(),
  fills: z.array(colorSchema).max(10).optional(), strokes: z.array(colorSchema).max(10).optional(),
  strokeWeight: finite.min(0).max(1000).optional(), cornerRadius: finite.min(0).max(10000).optional(),
  characters: z.string().max(20000).optional(), font: fontSchema.optional(), fontSize: finite.positive().max(1000).optional(),
  textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
  textAutoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']).optional(),
  lineHeight: z.union([z.object({ unit: z.literal('AUTO') }).strict(), z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: finite.positive().max(10000) }).strict()]).optional(),
  letterSpacing: z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: finite.min(-1000).max(10000) }).strict().optional(),
  autoLayout: autoLayoutSchema.optional(),
  layoutSizingHorizontal: z.enum(['FIXED', 'HUG', 'FILL']).optional(), layoutSizingVertical: z.enum(['FIXED', 'HUG', 'FILL']).optional(),
  clipsContent: z.boolean().optional()
}).strict();
export const readParamsSchema = z.object({ nodeIds: z.array(idSchema).min(1).max(50).optional(), depth: z.number().int().min(0).max(10).default(2), maxNodes: z.number().int().min(1).max(500).default(100), maxTextLength: z.number().int().min(0).max(20000).default(2000) }).strict();
export const exportParamsSchema = z.object({ nodeIds: z.array(idSchema).min(1).max(5).optional(), format: z.enum(['PNG', 'SVG']).default('PNG'), scale: finite.min(0.1).max(4).default(1) }).strict();
export const createParamsSchema = z.object({ type: z.enum(['FRAME', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'COMPONENT']), parentId: idSchema.optional(), properties: nodePropertiesSchema, select: z.boolean().default(true) }).strict();
export const updateParamsSchema = z.object({ nodeId: idSchema, properties: nodePropertiesSchema.refine(p => Object.keys(p).length > 0, 'Provide at least one property') }).strict();
export const commandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'), params: readParamsSchema }).strict(),
  z.object({ operation: z.literal('export'), params: exportParamsSchema }).strict(),
  z.object({ operation: z.literal('create'), params: createParamsSchema }).strict(),
  z.object({ operation: z.literal('update'), params: updateParamsSchema }).strict(),
  z.object({ operation: z.literal('selection'), params: z.object({}).strict() }).strict()
]);
export type Command = z.infer<typeof commandSchema>;
export type NodeProperties = z.infer<typeof nodePropertiesSchema>;
export const isMutation = (command: Command) => command.operation === 'create' || command.operation === 'update';
export const documentSchema = z.object({ name: z.string().max(500), fileKey: z.string().max(200).nullable(), pageId: idSchema, pageName: z.string().max(500), selection: z.array(z.object({ id: idSchema, name: z.string().max(500), type: z.string().max(100) }).strict()).max(500), selectionCount: z.number().int().min(0) }).strict();
export type DocumentInfo = z.infer<typeof documentSchema>;
export const errorSchema = z.object({ code: z.string().max(100), message: z.string().max(2000), details: z.record(z.string(), z.json()).optional() }).strict();
export type WireError = z.infer<typeof errorSchema>;
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('response'), requestId: requestIdSchema, ok: z.literal(true), data: z.json() }).strict(),
  z.object({ type: z.literal('response'), requestId: requestIdSchema, ok: z.literal(false), error: errorSchema }).strict()
]);
export type Response = z.infer<typeof responseSchema>;
export const pluginMessageSchema = z.union([
  z.object({ type: z.literal('hello'), version: z.literal(VERSION), token: z.string().regex(/^[a-f0-9]{64}$/), instanceId: requestIdSchema, document: documentSchema }).strict(),
  z.object({ type: z.literal('document'), document: documentSchema }).strict(), responseSchema
]);
export const requestSchema = z.object({ type: z.literal('request'), requestId: requestIdSchema, expiresAt: finite, command: commandSchema }).strict();
export type PluginRequest = z.infer<typeof requestSchema>;
export const serverMessageSchema = z.union([requestSchema, z.object({ type: z.literal('paired'), sessionId: idSchema }).strict(), z.object({ type: z.literal('error'), error: errorSchema }).strict()]);
export const rpcSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('sessions') }).strict(),
  z.object({ method: z.literal('request_status'), requestId: requestIdSchema }).strict(),
  z.object({ method: z.literal('execute'), sessionId: idSchema.optional(), requestId: requestIdSchema, command: commandSchema }).strict()
]);
export type Rpc = z.infer<typeof rpcSchema>;
export const exportResultSchema = z.object({ exports: z.array(z.object({ nodeId: idSchema, name: z.string().max(500), format: z.enum(['PNG', 'SVG']), mimeType: z.enum(['image/png', 'image/svg+xml']), width: finite.nonnegative(), height: finite.nonnegative(), scale: finite.positive(), base64: z.string().max(12 * 1024 * 1024) }).strict()).max(5) }).strict();
export const readResultSchema = z.object({
  document: documentSchema,
  nodes: z.array(z.object({ id: idSchema, name: z.string().max(500), type: z.string().max(100) }).catchall(z.json())).max(500),
  nodeCount: z.number().int().min(0).max(500), truncated: z.boolean(),
  limits: z.object({ depth: z.number().int().min(0).max(10), maxNodes: z.number().int().min(1).max(500), maxTextLength: z.number().int().min(0).max(20000) }).strict()
}).strict();
export const mutationResultSchema = z.object({ nodeId: idSchema, type: createParamsSchema.shape.type, name: z.string().max(500), created: z.boolean(), appliedProperties: z.array(z.string().max(100)).max(100) }).strict();
export function validResult(command: Command, data: unknown): boolean {
  switch (command.operation) {
    case 'selection': return documentSchema.safeParse(data).success;
    case 'read': return readResultSchema.safeParse(data).success;
    case 'export': return exportResultSchema.safeParse(data).success;
    case 'create': case 'update': return mutationResultSchema.safeParse(data).success;
  }
}
