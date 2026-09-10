import { fileURLToPath } from 'node:url';
import { configurePluginRegistration } from './plugin-registration.js';

const args = process.argv.slice(2);
if (args.length !== 1) {
  process.stderr.write('Usage: npm run plugin:configure -- /path/to/Figma-generated/manifest.json\n');
  process.exitCode = 1;
} else {
  try {
    await configurePluginRegistration(fileURLToPath(new URL('../', import.meta.url)), args[0]);
    process.stdout.write('Saved the Figma development registration locally. Run npm run build, then import dist/plugin/manifest.json in Figma.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not configure Figma development registration.'}\n`);
    process.exitCode = 1;
  }
}
