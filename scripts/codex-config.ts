import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../dist/mcp.js', import.meta.url));

try {
  await access(serverPath);
  process.stdout.write([
    '[mcp_servers.local_figma]',
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(serverPath)}]`,
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 45',
    ''
  ].join('\n'));
} catch {
  process.stderr.write('Build the connector with npm run build before generating the Codex configuration.\n');
  process.exitCode = 1;
}
