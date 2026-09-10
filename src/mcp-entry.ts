import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeClient } from './bridge/client.js';
import { readToken, settings } from './config.js';
import { createMcpServer } from './mcp/server.js';
import { wireError } from './errors.js';
import { registerBrowserTools } from './browser/tools.js';

try {
  const config = settings();
  const server = createMcpServer(new BridgeClient(config.url, await readToken()), config.exportDir);
  registerBrowserTools(server);
  await server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`${JSON.stringify(wireError(error))}\n`);
  process.exitCode = 1;
}
