import { z } from 'zod';

export const pairingTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const base = { type: z.literal('pairing'), requestId: z.string().uuid() };
export const pairingRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('load') }).strict(),
  z.object({ ...base, action: z.literal('save'), token: pairingTokenSchema }).strict(),
  z.object({ ...base, action: z.literal('forget') }).strict()
]);
export type PairingRequest = z.infer<typeof pairingRequestSchema>;
export const pairingResponseSchema = z.union([
  z.object({ type: z.literal('pairing-result'), requestId: z.string().uuid(), action: z.literal('load'), ok: z.literal(true), token: pairingTokenSchema.nullable() }).strict(),
  z.object({ type: z.literal('pairing-result'), requestId: z.string().uuid(), action: z.enum(['save', 'forget']), ok: z.literal(true) }).strict(),
  z.object({ type: z.literal('pairing-result'), requestId: z.string().uuid(), action: z.enum(['load', 'save', 'forget']), ok: z.literal(false), error: z.enum(['PAIRING_STORAGE_FAILED', 'PAIRING_ID_REQUIRED']) }).strict()
]);
export type PairingResult = z.infer<typeof pairingResponseSchema>;
