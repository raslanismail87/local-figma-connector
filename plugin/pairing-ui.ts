import { createSessionIdentity } from './identity.js';
import { pairingResponseSchema, type PairingRequest, type PairingResult } from './pairing-protocol.js';

type Controls = {
  remember: HTMLInputElement;
  forget: HTMLButtonElement;
  status: HTMLElement;
  currentToken: () => string;
  isPaired: () => boolean;
  restore: (token: string) => void;
  clear: () => void;
};

export class PairingPreferences {
  private revision = 0;
  private restoreRevision = 0;
  private savedToken: string | undefined;
  private pending = new Map<string, { action: PairingRequest['action']; complete: (result: PairingResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly controls: Controls) {
    controls.remember.addEventListener('change', () => {
      this.cancelRestore();
      this.revision++;
      if (!controls.remember.checked) this.forgetStored();
      else if (controls.isPaired()) this.rememberPaired();
      else controls.status.textContent = 'Pairing will be saved after a successful connection.';
    });
    controls.forget.addEventListener('click', () => {
      this.cancelRestore();
      this.revision++;
      controls.remember.checked = false;
      controls.clear();
      this.forgetStored();
    });
  }

  load() {
    const restoreRevision = this.restoreRevision;
    const revision = this.revision;
    this.request({ action: 'load' }, result => {
      if (revision !== this.revision) return;
      if (!result.ok) { this.controls.status.textContent = this.storageError(result, 'Could not load saved pairing. You can still connect manually.'); return; }
      if (result.action !== 'load' || !result.token) return;
      this.savedToken = result.token;
      this.controls.remember.checked = true;
      this.controls.forget.disabled = false;
      if (restoreRevision !== this.restoreRevision) {
        this.controls.status.textContent = 'A pairing is saved on this computer. Use Forget pairing to remove it.';
        if (this.controls.isPaired()) this.rememberPaired();
        return;
      }
      this.controls.status.textContent = 'Saved on this computer. Connecting automatically.';
      this.controls.restore(result.token);
    });
  }

  cancelRestore() { this.restoreRevision++; }

  rememberPaired() {
    const token = this.controls.currentToken();
    if (!this.controls.remember.checked || this.savedToken === token) return;
    const revision = this.revision;
    this.controls.forget.disabled = false;
    this.controls.status.textContent = 'Saving pairing on this computer…';
    this.request({ action: 'save', token }, result => {
      if (revision !== this.revision) return;
      if (!result.ok) { this.controls.status.textContent = this.storageError(result, 'Connected, but pairing could not be saved. Try toggling Remember again.'); return; }
      this.savedToken = token;
      this.controls.status.textContent = 'Pairing saved on this computer.';
    });
  }

  reject() {
    this.controls.remember.checked = false;
    this.cancelRestore();
    this.revision++;
    this.controls.clear();
    this.forgetStored();
  }

  receive(message: unknown): boolean {
    const parsed = pairingResponseSchema.safeParse(message);
    if (!parsed.success) return false;
    const pending = this.pending.get(parsed.data.requestId);
    if (!pending || pending.action !== parsed.data.action) return true;
    clearTimeout(pending.timer);
    this.pending.delete(parsed.data.requestId);
    pending.complete(parsed.data);
    return true;
  }

  private forgetStored() {
    const revision = this.revision;
    this.savedToken = undefined;
    this.controls.status.textContent = 'Removing saved pairing…';
    this.controls.forget.disabled = false;
    this.request({ action: 'forget' }, result => {
      if (revision !== this.revision) return;
      this.controls.forget.disabled = result.ok && !this.controls.currentToken();
      this.controls.status.textContent = result.ok
        ? 'No pairing saved. The key stays only while this plugin is open.'
        : this.storageError(result, 'Could not remove saved pairing. Click Forget pairing to try again.');
    });
  }

  private storageError(result: PairingResult, fallback: string) {
    return !result.ok && result.error === 'PAIRING_ID_REQUIRED'
      ? 'Figma development ID required; see Remember pairing in README.'
      : fallback;
  }

  private request(payload: { action: 'load' | 'forget' } | { action: 'save'; token: string }, complete: (result: PairingResult) => void) {
    const requestId = createSessionIdentity();
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      complete({ type: 'pairing-result', requestId, action: payload.action, ok: false, error: 'PAIRING_STORAGE_FAILED' });
    }, 10000);
    this.pending.set(requestId, { action: payload.action, complete, timer });
    parent.postMessage({ pluginMessage: { type: 'pairing', requestId, ...payload } }, '*');
  }
}
