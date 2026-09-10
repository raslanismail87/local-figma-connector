import { initializeCredentials, readToken } from './config.js';
import { wireError } from './errors.js';
import { copyToClipboard } from './platform/clipboard.js';

try {
  if (process.argv[2] === 'setup') {
    const config = await initializeCredentials();
    process.stdout.write(`Private credentials ready in ${config.stateDir}.\nBuild: npm run build\nStart: npm run bridge\nPair: npm run pair (copies the key to the clipboard)\n`);
  } else if (process.argv[2] === 'pair') {
    const token = await readToken();
    await copyToClipboard(token);
    process.stdout.write('Pairing key copied to clipboard. Paste it into the plugin pairing field, then replace the clipboard contents when finished.\n');
  } else { process.stderr.write('Usage: npm run setup | npm run pair\n'); process.exitCode = 1; }
} catch (error) { process.stderr.write(`${JSON.stringify(wireError(error))}\n`); process.exitCode = 1; }
