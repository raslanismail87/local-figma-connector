import { documentSchema, MAX_MESSAGE_BYTES, responseSchema, serverMessageSchema, VERSION, type DocumentInfo } from '../src/protocol.js';
import { boundedResponse, serializeWithinLimit } from './wire-size.js';
import { createSessionIdentity } from './identity.js';
import { PairingPreferences } from './pairing-ui.js';

const tokenInput = document.querySelector<HTMLInputElement>('#token')!;
const connectButton = document.querySelector<HTMLButtonElement>('#connect')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const statusText = document.querySelector<HTMLElement>('#status')!;
const documentText = document.querySelector<HTMLElement>('#document')!;
const dot = document.querySelector<HTMLElement>('#dot')!;
const instanceId = createSessionIdentity();
const pending = new Set<string>();
let documentInfo: DocumentInfo | undefined;
let socket: WebSocket | undefined;
let paired = false;
let token = '';
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let shouldConnect = false;
const pairingPreferences = new PairingPreferences({
  remember: document.querySelector<HTMLInputElement>('#remember')!,
  forget: document.querySelector<HTMLButtonElement>('#forget')!,
  status: document.querySelector<HTMLElement>('#pairing-status')!,
  currentToken: () => token, isPaired: () => paired,
  restore: saved => { token = saved; startConnection(); },
  clear: () => { token = ''; tokenInput.value = ''; stopConnection(); }
});

function showStatus(message: string, state: 'idle' | 'connected' | 'error' = 'idle') {
  statusText.textContent = message;
  dot.dataset.state = state;
}

function closeConnection() {
  clearTimeout(reconnectTimer);
  paired = false;
  pending.clear();
  const previous = socket;
  socket = undefined;
  previous?.close();
}

function stopConnection(message = 'Disconnected', state: 'idle' | 'error' = 'idle') {
  shouldConnect = false;
  closeConnection();
  connectButton.textContent = 'Connect';
  disconnectButton.disabled = true;
  tokenInput.disabled = false;
  showStatus(message, state);
}

function send(value: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const serialized = serializeWithinLimit(value);
  if (serialized === undefined) {
    showStatus('Message too large. Reduce the selection and reconnect.', 'error');
    return;
  }
  socket.send(serialized);
}

function openConnection() {
  if (!shouldConnect || !documentInfo) return;
  closeConnection();
  showStatus(attempt === 0 ? 'Connecting to local bridge…' : 'Reconnecting to local bridge…');
  const connection = new WebSocket('ws://localhost:3845/plugin');
  socket = connection;
  connection.onopen = () => {
    if (socket !== connection || !documentInfo) return;
    send({ type: 'hello', version: VERSION, token, instanceId, document: documentInfo });
  };
  connection.onmessage = event => {
    if (socket !== connection || typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) return;
    let raw: unknown;
    try { raw = JSON.parse(event.data); } catch { return; }
    const parsed = serverMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'paired') {
      paired = true;
      attempt = 0;
      showStatus('Connected · ready for Codex', 'connected');
      pairingPreferences.rememberPaired();
      return;
    }
    if (message.type === 'error') {
      if (message.error.code === 'AUTH_FAILED') pairingPreferences.reject();
      stopConnection(message.error.message, 'error');
      return;
    }
    if (!paired || pending.has(message.requestId)) return;
    pending.add(message.requestId);
    parent.postMessage({ pluginMessage: message }, '*');
  };
  connection.onclose = event => {
    if (socket !== connection) return;
    socket = undefined;
    paired = false;
    pending.clear();
    if (!shouldConnect) return;
    if (event.code === 1008) {
      pairingPreferences.reject();
      stopConnection('Pairing rejected. Check the token and connect again.', 'error');
      return;
    }
    const delay = Math.min(1000 * 2 ** attempt++, 15000);
    showStatus(`Bridge unavailable. Retrying in ${delay / 1000}s…`, 'error');
    reconnectTimer = setTimeout(openConnection, delay);
  };
  connection.onerror = () => { if (socket === connection) showStatus('Cannot reach the local bridge.', 'error'); };
}

window.addEventListener('message', event => {
  const fromFigmaHost = event.source === top && ['https://www.figma.com', 'https://figma.com'].includes(event.origin);
  if ((event.source !== parent && !fromFigmaHost) || !event.data || typeof event.data !== 'object') return;
  const message: unknown = event.data.pluginMessage;
  if (pairingPreferences.receive(message)) return;
  if (typeof message !== 'object' || message === null || !('type' in message)) return;
  if (message.type === 'document' && 'document' in message) {
    const parsed = documentSchema.safeParse(message.document);
    if (!parsed.success) return;
    documentInfo = parsed.data;
    documentText.textContent = `${documentInfo.name} / ${documentInfo.pageName} · ${documentInfo.selectionCount} selected`;
    if (paired) send({ type: 'document', document: documentInfo });
    else if (shouldConnect && !socket && !reconnectTimer) openConnection();
    return;
  }
  const parsed = responseSchema.safeParse(message);
  if (!parsed.success || !paired || !pending.delete(parsed.data.requestId)) return;
  send(boundedResponse(parsed.data));
});

connectButton.addEventListener('click', event => {
  event.preventDefault();
  pairingPreferences.cancelRestore();
  const candidate = tokenInput.value.trim();
  if ((candidate && !/^[a-f0-9]{64}$/.test(candidate)) || (!candidate && !token)) {
    showStatus('Paste the 64-character token from npm run pair.', 'error');
    return;
  }
  if (candidate) token = candidate;
  startConnection();
});

function startConnection() {
  document.querySelector<HTMLButtonElement>('#forget')!.disabled = false;
  tokenInput.value = '';
  tokenInput.disabled = true;
  shouldConnect = true;
  attempt = 0;
  disconnectButton.disabled = false;
  connectButton.textContent = 'Reconnect';
  if (!documentInfo) showStatus('Waiting for Figma document…');
  else openConnection();
}
tokenInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); connectButton.click(); }
});
tokenInput.addEventListener('input', () => pairingPreferences.cancelRestore());
disconnectButton.addEventListener('click', () => { pairingPreferences.cancelRestore(); stopConnection(); });
parent.postMessage({ pluginMessage: { type: 'ready' } }, '*');

pairingPreferences.load();
