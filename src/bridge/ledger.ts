import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { responseSchema } from '../protocol.js';
import { ConnectorError } from '../errors.js';

const inspectionSchema = z.object({ operation: z.enum(['create', 'update']), nodeId: z.string().nullable(), parentId: z.string().nullable(), nodeType: z.string().nullable(), intendedName: z.string().nullable(), documentName: z.string(), pageId: z.string() }).strict();
const recordSchema = z.object({ requestId: z.uuid(), fingerprint: z.string(), sessionId: z.string(), state: z.enum(['pending', 'uncertain', 'completed']), createdAt: z.string(), inspection: inspectionSchema.optional(), response: responseSchema.optional() }).strict();
export type MutationRecord = z.infer<typeof recordSchema>;
export class MutationLedger {
  private records = new Map<string, MutationRecord>();
  constructor(private path?: string) {
    if (!path) return;
    try {
      const rows = z.array(recordSchema).parse(JSON.parse(readFileSync(path, 'utf8')));
      for (const row of rows) this.records.set(row.requestId, { ...row, state: row.state === 'pending' ? 'uncertain' : row.state });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ConnectorError('LEDGER_UNREADABLE', 'Cannot read the mutation ledger. Restore it before starting; deleting it loses duplicate protection.');
    }
  }
  get(id: string) { return this.records.get(id); }
  put(record: MutationRecord) {
    if (!this.records.has(record.requestId) && this.records.size >= 10000) throw new ConnectorError('LEDGER_FULL', 'Mutation ledger reached 10,000 entries. Archive it only after all outcomes are inspected and use fresh mutation IDs.');
    const prior = this.records.get(record.requestId);
    this.records.set(record.requestId, record);
    try { this.persist(); } catch {
      if (prior) this.records.set(record.requestId, prior); else this.records.delete(record.requestId);
      throw new ConnectorError('LEDGER_WRITE_FAILED', 'Cannot persist mutation status; inspect the document before retrying.');
    }
  }
  private persist() {
    if (!this.path) return;
    writeFileSync(`${this.path}.tmp`, JSON.stringify([...this.records.values()]), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
