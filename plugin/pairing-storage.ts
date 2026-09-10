import { pairingTokenSchema, type PairingRequest, type PairingResult } from './pairing-protocol.js';

const storageKey = 'local-figma-connector.pairing.v1';
type Storage = Pick<ClientStorageAPI, 'getAsync' | 'setAsync' | 'deleteAsync'>;

export class PairingStorage {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: Storage, private readonly pluginId: string | undefined) {}

  handle(request: PairingRequest): Promise<PairingResult> {
    const result = this.queue.then(() => this.execute(request));
    this.queue = result.catch(() => {});
    return result;
  }

  private async execute(request: PairingRequest): Promise<PairingResult> {
    const response = { type: 'pairing-result' as const, requestId: request.requestId, action: request.action };
    if (!this.pluginId) return { ...response, ok: false, error: 'PAIRING_ID_REQUIRED' };
    try {
      if (request.action === 'load') {
        const stored: unknown = await this.storage.getAsync(storageKey);
        const token = pairingTokenSchema.safeParse(stored);
        if (stored !== undefined && stored !== null && !token.success) await this.storage.deleteAsync(storageKey);
        return { ...response, action: 'load', ok: true, token: token.success ? token.data : null };
      }
      if (request.action === 'save') await this.storage.setAsync(storageKey, request.token);
      else await this.storage.deleteAsync(storageKey);
      return { ...response, action: request.action, ok: true };
    } catch {
      return { ...response, ok: false, error: 'PAIRING_STORAGE_FAILED' };
    }
  }
}
