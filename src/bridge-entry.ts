import { readToken, settings } from './config.js';
import { startBridge } from './bridge/server.js';
import { wireError } from './errors.js';

try {
  const config = settings();
  const bridge = await startBridge({ token: await readToken(), port: config.port, ledgerPath: config.ledgerFile });
  process.stderr.write(`Local Figma bridge listening at 127.0.0.1:${bridge.port}. Open the desktop plugin and pair it.\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void bridge.close().then(() => process.exit(0)); });
} catch (error) {
  process.stderr.write(`${JSON.stringify(wireError(error))}\n`);
  process.exitCode = 1;
}
