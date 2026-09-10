import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConnectorError } from './errors.js';

export function settings() {
  const stateDir = process.env.FIGMA_CONNECTOR_STATE_DIR ?? join(homedir(), '.local', 'share', 'figma-connector');
  const port = Number(process.env.FIGMA_CONNECTOR_PORT ?? 3845);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ConnectorError('CONFIG_ERROR', 'FIGMA_CONNECTOR_PORT must be 1024–65535. Update the plugin manifest when changing it.');
  return { stateDir, port, tokenFile: join(stateDir, 'token'), ledgerFile: join(stateDir, 'mutations.json'), exportDir: join(stateDir, 'exports'), url: `http://127.0.0.1:${port}` };
}
export async function initializeCredentials() {
  const config = settings();
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  try { await writeFile(config.tokenFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await readToken(config.tokenFile);
  return config;
}
export async function readToken(path = settings().tokenFile) {
  try {
    const info = await stat(path);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new ConnectorError('CREDENTIAL_PERMISSIONS', 'Token file must be private. Run chmod 600 on the token file.');
    const token = (await readFile(path, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ConnectorError('CONFIG_ERROR', 'Invalid token file. Restore the token or remove it and rerun npm run setup.');
    return token;
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError('SETUP_REQUIRED', 'Run npm run setup in the connector project before starting the bridge or MCP.');
  }
}
