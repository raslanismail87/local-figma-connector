import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { BridgeClient } from '../src/bridge/client.js';
import { MAX_MESSAGE_BYTES } from '../src/protocol.js';
import { errorCode, mutation, selection } from './bridge-fixture.js';

test('bridge clients reject non-loopback, authenticated URLs, and non-HTTP transports', () => {
  for (const url of ['https://127.0.0.1:3845', 'http://localhost:3845', 'http://attacker.example:3845', 'http://user:secret@127.0.0.1:3845']) {
    assert.throws(() => new BridgeClient(url, 'fixture'), errorCode('CONFIG_ERROR'));
  }
});

test('malformed or oversized bridge replies remain typed errors and cannot imply mutation success', async t => {
  let body = '{';
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const client = new BridgeClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`, 'fixture');
  for (const invalid of ['{', ' '.repeat(MAX_MESSAGE_BYTES + 1)]) {
    body = invalid;
    await assert.rejects(client.call({ method: 'execute', requestId: randomUUID(), command: selection }), errorCode('INVALID_BRIDGE_RESPONSE'));
    await assert.rejects(client.call({ method: 'execute', requestId: randomUUID(), command: mutation }), errorCode('OUTCOME_UNCERTAIN'));
  }
  body = JSON.stringify({ unexpected: true });
  await assert.rejects(client.call({ method: 'execute', requestId: randomUUID(), command: mutation }), error => {
    assert.equal((error as { code: string }).code, 'INVALID_BRIDGE_RESPONSE');
    assert.equal((error as { details: { retrySafe: boolean } }).details.retrySafe, false);
    return true;
  });
});
