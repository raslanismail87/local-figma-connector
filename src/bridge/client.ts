import { z } from 'zod';
import { errorSchema, MAX_MESSAGE_BYTES, type Rpc } from '../protocol.js';
import { ConnectorError } from '../errors.js';

const envelope = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data: z.unknown() }).strict(), z.object({ ok: z.literal(false), error: errorSchema }).strict()]);
export class BridgeClient {
  constructor(private url: string, private token: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new ConnectorError('CONFIG_ERROR', 'Bridge must use http://127.0.0.1 on a local port.');
  }
  async call(rpc: Rpc): Promise<unknown> {
    let reply;
    try {
      reply = await fetch(`${this.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(rpc), signal: AbortSignal.timeout(35000), redirect: 'error' });
    } catch {
      const dispatchedMutation = rpc.method === 'execute' && ['create', 'update'].includes(rpc.command.operation);
      throw new ConnectorError(dispatchedMutation ? 'OUTCOME_UNCERTAIN' : 'BRIDGE_UNAVAILABLE', dispatchedMutation ? 'Bridge connection failed. The mutation may have been dispatched. Inspect request status and the document before any retry.' : 'Cannot reach the local bridge. Start npm run bridge, then reconnect the Figma plugin.', dispatchedMutation ? { requestId: rpc.requestId, retrySafe: false } : undefined);
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let input: unknown;
    try {
      if (!reply.body) throw new Error('Missing body');
      const reader = reply.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_MESSAGE_BYTES) { await reader.cancel(); throw new Error('Response too large'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      const mutation = rpc.method === 'execute' && ['create', 'update'].includes(rpc.command.operation);
      throw new ConnectorError(mutation ? 'OUTCOME_UNCERTAIN' : 'INVALID_BRIDGE_RESPONSE', 'Bridge returned an unreadable response. Inspect mutation status before retrying.', rpc.method === 'execute' ? { requestId: rpc.requestId, retrySafe: !mutation } : undefined);
    }
    const parsed = envelope.safeParse(input);
    if (!parsed.success) throw new ConnectorError('INVALID_BRIDGE_RESPONSE', 'Bridge returned an invalid response. Inspect mutation status before retrying.', rpc.method === 'execute' ? { requestId: rpc.requestId, retrySafe: false } : undefined);
    if (!parsed.data.ok) throw new ConnectorError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    return parsed.data.data;
  }
}
