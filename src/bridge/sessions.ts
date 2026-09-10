import { createHash, randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import type { WebSocket } from 'ws';
import { ConnectorError } from '../errors.js';
import { isMutation, validResult, type Command, type DocumentInfo, type Response } from '../protocol.js';
import { MutationLedger } from './ledger.js';

type Session = { id: string; instanceId: string; document: DocumentInfo; socket: WebSocket; connectedAt: string };
type Pending = { sessionId: string; mutation: boolean; command: Command; timer: NodeJS.Timeout | number; resolve: (value: Response) => void; reject: (reason: unknown) => void; timedOut: boolean };
export class Sessions {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();
  constructor(private ledger: MutationLedger, private timeoutMs = 30000) {}
  connect(socket: WebSocket, instanceId: string, document: DocumentInfo) {
    for (const existing of this.sessions.values()) if (existing.instanceId === instanceId) {
      this.disconnect(existing.id);
      existing.socket.close(1000, 'Reconnected');
    }
    const id = randomUUID();
    this.sessions.set(id, { id, instanceId, document, socket, connectedAt: new Date().toISOString() });
    return id;
  }
  update(id: string, document: DocumentInfo) { const session = this.sessions.get(id); if (session) session.document = document; }
  list() { return [...this.sessions.values()].map(({ socket: _, ...session }) => session); }
  status(id: string) {
    const record = this.ledger.get(id);
    if (!record) throw new ConnectorError('REQUEST_NOT_FOUND', 'No retained mutation with this request ID. Reads are not retained. Do not assume an unknown mutation did not execute.');
    const { fingerprint: _, ...status } = record;
    return status;
  }
  async execute(sessionId: string | undefined, requestId: string, command: Command): Promise<Response> {
    const mutation = isMutation(command);
    const fingerprint = createHash('sha256').update(JSON.stringify({ sessionId, command })).digest('hex');
    const previous = this.ledger.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ConnectorError('REQUEST_ID_CONFLICT', 'This mutation ID was already used with different arguments or session.');
      if (previous.response) return previous.response;
      throw this.uncertain(requestId, previous.sessionId, 'This mutation was already submitted. Inspect its status and document before deciding what to do next.');
    }
    if (this.pending.has(requestId)) throw new ConnectorError('REQUEST_ID_CONFLICT', 'Request ID is already in flight.');
    const session = this.target(sessionId);
    if (mutation && [...this.pending.values()].some(p => p.mutation && p.sessionId === session.id)) throw new ConnectorError('SESSION_BUSY', 'A mutation is still running or has an uncertain outcome. Wait for its response, inspect status, or reconnect after checking the document.');
    if (this.pending.size >= 100) throw new ConnectorError('BUSY', 'Too many in-flight requests. Wait before submitting another.');
    if (command.operation === 'create' || command.operation === 'update') {
      const inspection = {
        operation: command.operation,
        nodeId: command.operation === 'update' ? command.params.nodeId : null,
        parentId: command.operation === 'create' ? command.params.parentId ?? session.document.pageId : null,
        nodeType: command.operation === 'create' ? command.params.type : null,
        intendedName: command.params.properties.name ?? null,
        documentName: session.document.name, pageId: session.document.pageId
      };
      this.ledger.put({ requestId, fingerprint, sessionId: session.id, state: 'pending', createdAt: new Date().toISOString(), inspection });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        pending.timedOut = true;
        if (mutation) {
          this.markUncertain(requestId);
          reject(this.uncertain(requestId, session.id, 'Timed out after dispatch. The mutation may have completed or may still run. Nothing was replayed.'));
        } else {
          this.pending.delete(requestId);
          reject(new ConnectorError('TIMEOUT', 'Plugin did not respond. Check that it is open and reconnect.', { requestId, sessionId: session.id }));
        }
      }, this.timeoutMs);
      this.pending.set(requestId, { sessionId: session.id, mutation, command, timer, resolve, reject, timedOut: false });
      session.socket.send(JSON.stringify({ type: 'request', requestId, command, expiresAt: Date.now() + this.timeoutMs }), error => {
        if (error) this.disconnect(session.id);
      });
    });
  }
  receive(sessionId: string, response: Response) {
    const pending = this.pending.get(response.requestId);
    if (!pending || pending.sessionId !== sessionId) return;
    if (response.ok && !validResult(pending.command, response.data)) {
      if (pending.mutation) {
        this.markUncertain(response.requestId);
        pending.reject(this.uncertain(response.requestId, sessionId, 'Plugin returned an invalid mutation result. Inspect the document before retrying.'));
      } else {
        clearTimeout(pending.timer);
        this.pending.delete(response.requestId);
        pending.reject(new ConnectorError('INVALID_PLUGIN_RESPONSE', 'Plugin result does not match the requested operation.'));
      }
      return;
    }
    clearTimeout(pending.timer);
    if (pending.mutation) {
      const record = this.ledger.get(response.requestId)!;
      try { this.ledger.put({ ...record, state: 'completed', response }); }
      catch (error) { pending.reject(error); this.pending.delete(response.requestId); return; }
    }
    this.pending.delete(response.requestId);
    pending.resolve(response);
  }
  disconnect(id: string) {
    this.sessions.delete(id);
    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId !== id) continue;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      if (pending.mutation) this.markUncertain(requestId);
      pending.reject(pending.mutation ? this.uncertain(requestId, id, 'Plugin disconnected after dispatch. Inspect the document before retrying; the operation was not replayed.') : new ConnectorError('DISCONNECTED', 'Plugin disconnected. Reopen or reconnect it.', { requestId, sessionId: id }));
    }
  }
  private target(id?: string) {
    if (!id && this.sessions.size > 1) throw new ConnectorError('SESSION_REQUIRED', 'Multiple plugins are connected. List sessions and supply the intended sessionId.');
    const session = id ? this.sessions.get(id) : this.sessions.values().next().value;
    if (!session) throw new ConnectorError('NOT_CONNECTED', 'Open Local Figma Connector in Figma desktop and pair it. Use figma_sessions to inspect available targets.');
    return session;
  }
  private markUncertain(id: string) {
    const record = this.ledger.get(id);
    if (record) { try { this.ledger.put({ ...record, state: 'uncertain' }); } catch { /* Pending records become uncertain on restart. */ } }
  }
  private uncertain(requestId: string, sessionId: string, message: string) {
    const inspection = this.ledger.get(requestId)?.inspection;
    return new ConnectorError('OUTCOME_UNCERTAIN', message, { requestId, sessionId, retrySafe: false, ...(inspection ? { inspection } : {}), nextStep: 'Call figma_request_status, then read affected nodes. Never automatically retry with a new mutationId.' });
  }
}
