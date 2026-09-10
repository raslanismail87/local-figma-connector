import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, pluginMessageSchema, rpcSchema } from '../protocol.js';
import { ConnectorError, wireError } from '../errors.js';
import { MutationLedger } from './ledger.js';
import { Sessions } from './sessions.js';

export async function startBridge(options: { token: string; port: number; ledgerPath?: string; timeoutMs?: number }) {
  const sessions = new Sessions(new MutationLedger(options.ledgerPath), options.timeoutMs);
  const authenticated = (candidate: string | undefined) => Boolean(candidate && /^[a-f0-9]{64}$/.test(candidate) && timingSafeEqual(Buffer.from(candidate), Buffer.from(options.token)));
  const http = createServer((req, res) => { void route(req, res).catch(error => respond(res, 400, { ok: false, error: wireError(error) })); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const validHost = (req: IncomingMessage) => req.headers.host === `127.0.0.1:${(http.address() as { port: number }).port}`;
  async function route(req: IncomingMessage, res: ServerResponse) {
    if (!validHost(req) || req.headers.origin) return respond(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Only authenticated local clients can access this endpoint.' } });
    if (!authenticated(req.headers.authorization?.replace(/^Bearer /, ''))) return respond(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
    if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true, version: 1, sessions: sessions.list().length });
    if (req.method !== 'POST' || req.url !== '/rpc') return respond(res, 404, { ok: false });
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 256 * 1024) throw new ConnectorError('MESSAGE_TOO_LARGE', 'Request exceeds 256 KiB.');
      chunks.push(chunk);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ConnectorError('INVALID_MESSAGE', 'Expected JSON.'); }
    const parsed = rpcSchema.safeParse(input);
    if (!parsed.success) throw new ConnectorError('INVALID_MESSAGE', 'Request does not match the supported protocol.');
    const rpc = parsed.data;
    const data = rpc.method === 'sessions' ? { sessions: sessions.list() } : rpc.method === 'request_status' ? sessions.status(rpc.requestId) : await sessions.execute(rpc.sessionId, rpc.requestId, rpc.command);
    respond(res, 200, { ok: true, data });
  }
  http.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const originAllowed = !origin || origin === 'null' || origin === 'https://www.figma.com' || origin === 'https://figma.com';
    const pluginHostAllowed = validHost(req) || req.headers.host === `localhost:${(http.address() as { port: number }).port}`;
    if (!pluginHostAllowed || req.url !== '/plugin' || !originAllowed || sockets.clients.size >= 16) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', socket => {
    let sessionId: string | undefined;
    let alive = true;
    const authTimer = setTimeout(() => socket.close(1008, 'Pairing required'), 5000);
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping(); } }, 15000);
    socket.on('message', raw => {
      let parsed;
      try { parsed = pluginMessageSchema.safeParse(JSON.parse(raw.toString())); } catch { socket.close(1008, 'Invalid message'); return; }
      if (!parsed.success) { socket.close(1008, 'Invalid message'); return; }
      const message = parsed.data;
      if (!sessionId) {
        if (message.type !== 'hello' || !authenticated(message.token)) { socket.close(1008, 'Pairing failed'); return; }
        clearTimeout(authTimer);
        sessionId = sessions.connect(socket, message.instanceId, message.document);
        socket.send(JSON.stringify({ type: 'paired', sessionId }));
        return;
      }
      if (message.type === 'document') sessions.update(sessionId, message.document);
      else if (message.type === 'response') sessions.receive(sessionId, message);
      else socket.close(1008, 'Already paired');
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(authTimer); clearInterval(heartbeat); if (sessionId) sessions.disconnect(sessionId); });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', error => reject(new ConnectorError((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'BRIDGE_START_FAILED', (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${options.port} is already in use. Stop the earlier bridge or configure a separate port in the server and plugin.` : 'The local bridge could not start. Check the configured loopback port.')));
    http.listen(options.port, '127.0.0.1', resolve);
  });
  return { port: (http.address() as { port: number }).port, sessions, close: async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  } };
}
function respond(res: ServerResponse, status: number, data: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
