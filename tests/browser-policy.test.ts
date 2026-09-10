import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { validateCdpEndpoint, validatePageUrl } from '../src/browser/policy.js';
import { registerBrowserTools } from '../src/browser/tools.js';

const rejectedEndpoints = [
  'ws://127.0.0.1:9222/devtools/browser/id', 'https://127.0.0.1:9222', 'http://localhost:9222',
  'http://0.0.0.0:9222', 'http://192.168.1.1:9222', 'http://[::1]:9222', 'http://2130706433:9222',
  'http://127.1:9222', 'http://127.0.0.1:65536', 'http://127.0.0.1:0', 'http://127.0.0.1:09222',
  'http://user@127.0.0.1:9222', 'http://127.0.0.1:9222/json', 'http://127.0.0.1:9222?x=1',
  'http://127.0.0.1:9222#x', ' http://127.0.0.1:9222', 'http://127.0.0.1:9222\\@example.com',
];

test('CDP config accepts only explicit canonical IPv4 loopback HTTP endpoints', () => {
  assert.equal(validateCdpEndpoint('http://127.0.0.1:9222/'), 'http://127.0.0.1:9222');
  for (const endpoint of rejectedEndpoints) assert.throws(() => validateCdpEndpoint(endpoint), { code: 'CHROME_CONFIG_ERROR' }, endpoint);
});

test('browser navigation permits only Figma and an explicitly injected local fixture origin', () => {
  assert.equal(validatePageUrl('https://www.figma.com/design/example'), 'https://www.figma.com/design/example');
  assert.equal(validatePageUrl('about:blank'), 'about:blank');
  for (const url of ['https://figma.com.attacker.test/', 'https://evilfigma.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'http://www.figma.com/', 'https://user@figma.com/', 'https://www.figma.com:8443/', 'http://127.0.0.1:3888/']) {
    assert.throws(() => validatePageUrl(url), { code: 'CHROME_URL_REJECTED' }, url);
  }
  assert.equal(validatePageUrl('http://127.0.0.1:3888/fixture', 'http://127.0.0.1:3888'), 'http://127.0.0.1:3888/fixture');
  assert.throws(() => validatePageUrl('http://127.0.0.1:3889/fixture', 'http://127.0.0.1:3888'), { code: 'CHROME_URL_REJECTED' });
});

test('optional Chrome tools are typed, expose no evaluation, and report disabled without connecting', async () => {
  const server = new McpServer({ name: 'browser-test', version: '1.0.0' });
  const adapter = registerBrowserTools(server, { endpoint: '' });
  const client = new Client({ name: 'browser-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 9);
    assert.equal(tools.some(tool => /eval|script|execute/i.test(tool.name)), false);
    const result = await client.callTool({ name: 'chrome_tabs', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /CHROME_DISABLED/);
    const invalid = await client.callTool({ name: 'chrome_click', arguments: { target: { x: -1, y: 30 } } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); await adapter.disconnect(); }
});

test('unavailable local CDP reports an actionable error without claiming a browser action happened', async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  const server = new McpServer({ name: 'browser-test', version: '1.0.0' });
  const adapter = registerBrowserTools(server, { endpoint: `http://127.0.0.1:${port}`, timeoutMs: 500 });
  const client = new Client({ name: 'browser-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'chrome_open_tab', arguments: { url: 'about:blank' } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /CHROME_UNAVAILABLE/);
    assert.match(JSON.stringify(result.content), /No browser action was submitted/);
  } finally { await client.close(); await server.close(); await adapter.disconnect(); }
});
