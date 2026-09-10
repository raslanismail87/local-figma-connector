import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { configuredPluginManifest } from './plugin-registration.js';

const manifest = await configuredPluginManifest(process.cwd(), JSON.parse(await readFile('plugin/manifest.json', 'utf8')));

await mkdir('dist/plugin', { recursive: true });
await build({ entryPoints: { bridge: 'src/bridge-entry.ts', mcp: 'src/mcp-entry.ts' }, outdir: 'dist', bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external' });
await build({ entryPoints: ['plugin/main.ts'], outfile: 'dist/plugin/main.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2017', minifyWhitespace: true, legalComments: 'none' });
const ui = await build({ entryPoints: ['plugin/ui.ts'], write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minifyWhitespace: true, legalComments: 'none' });
const html = await readFile('plugin/ui.html', 'utf8');
const renderedHtml = html.replace('<!-- SCRIPT -->', () => ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
const embeddedScript = renderedHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
if (!embeddedScript || renderedHtml.includes('<!-- SCRIPT -->')) throw new Error('Plugin UI script was not embedded.');
new Script(embeddedScript, { filename: 'dist/plugin/ui.html' });
await writeFile('dist/plugin/ui.html', renderedHtml);
await writeFile('dist/plugin/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile('LICENSE', 'dist/plugin/LICENSE');
await copyFile('node_modules/zod/LICENSE', 'dist/plugin/ZOD-LICENSE');
process.stdout.write('Built bridge, MCP server, and importable dist/plugin/manifest.json\n');
