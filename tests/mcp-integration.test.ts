import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startBridge } from '../src/bridge/server.js';
import { BridgeClient } from '../src/bridge/client.js';
import { createMcpServer } from '../src/mcp/server.js';

export const document = { name: 'Disposable connector fixture', fileKey: null, pageId: '0:1', pageName: 'Page 1', selection: [{ id: '1:1', name: 'Example', type: 'RECTANGLE' }], selectionCount: 1 };
export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('MCP → authenticated bridge → plugin peer: selection read and usable PNG preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-mcp-'));
  const token = randomBytes(32).toString('hex');
  const bridge = await startBridge({ token, port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/plugin`);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const server = createMcpServer(new BridgeClient(`http://127.0.0.1:${bridge.port}`, token), directory);
  try {
    await once(socket, 'open');
    const paired = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'hello', version: 1, token, instanceId: randomUUID(), document }));
    await paired;
    // The peer represents the Plugin API boundary; this is not a live Figma test.
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString());
      if (request.type !== 'request') return;
      const data = request.command.operation === 'export'
        ? { exports: [{ nodeId: '1:1', name: 'Example', format: 'PNG', mimeType: 'image/png', width: 1, height: 1, scale: 1, base64: png }] }
        : { document, nodes: [{ id: '1:1', name: 'Example', type: 'RECTANGLE', width: 1, height: 1 }], nodeCount: 1, truncated: false, limits: { depth: 2, maxNodes: 100, maxTextLength: 2000 } };
      socket.send(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, data }));
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 7);
    const read = await client.callTool({ name: 'figma_read_nodes', arguments: {} });
    assert.notEqual(read.isError, true);
    assert.match(JSON.stringify(read.content), /Example/);
    const exported = await client.callTool({ name: 'figma_export_nodes', arguments: {} });
    assert.notEqual(exported.isError, true);
    assert.ok((exported.content as { type: string }[]).some(c => c.type === 'image'));
    const exports = (exported.structuredContent as { exports: { path: string }[] }).exports;
    assert.deepEqual(await readFile(exports[0].path), Buffer.from(png, 'base64'));
    const invalid = await client.callTool({ name: 'figma_read_nodes', arguments: { depth: 1000 } });
    assert.equal(invalid.isError, true);
  } finally { socket.terminate(); await client.close(); await server.close(); await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});
