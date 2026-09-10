import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bridgeFixture, document, respondSelection } from './bridge-fixture.js';

test('stdio MCP subprocess initializes, lists tools, and reads a paired plugin through the bridge', async t => {
  const bridge = await bridgeFixture(t);
  const peer = await bridge.connect();
  const directory = await mkdtemp(join(tmpdir(), 'figma-stdio-'));
  await writeFile(join(directory, 'token'), bridge.token, { mode: 0o600 });
  const client = new Client({ name: 'stdio-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/mcp-entry.ts', import.meta.url))],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { FIGMA_CONNECTOR_STATE_DIR: directory, FIGMA_CONNECTOR_PORT: String(bridge.port) },
    stderr: 'pipe'
  });
  try {
    peer.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'request') respondSelection(peer.socket, message.requestId);
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).filter(name => name.startsWith('figma_')).sort(), [
      'figma_create_node', 'figma_export_nodes', 'figma_read_nodes', 'figma_request_status',
      'figma_selection', 'figma_sessions', 'figma_update_node'
    ]);
    const sessions = await client.callTool({ name: 'figma_sessions', arguments: {} });
    assert.notEqual(sessions.isError, true);
    assert.match(JSON.stringify(sessions.structuredContent), new RegExp(peer.sessionId));
    const selected = await client.callTool({ name: 'figma_selection', arguments: { sessionId: peer.sessionId } });
    assert.notEqual(selected.isError, true);
    assert.deepEqual((selected.structuredContent as { result: { data: unknown } }).result.data, document);
  } finally {
    await client.close();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  }
});
