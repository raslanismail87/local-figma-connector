import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configuredPluginManifest, configurePluginRegistration } from '../scripts/plugin-registration.js';

test('local registration imports only an ID and preserves production network restrictions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-registration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = { name: 'Connector', networkAccess: { allowedDomains: ['none'], devAllowedDomains: ['ws://localhost:3845'] }, main: 'main.js' };
  assert.deepEqual(await configuredPluginManifest(directory, manifest), manifest);
  const source = join(directory, 'manifest.json');
  await writeFile(source, JSON.stringify({ id: '123456789', name: 'Generated', networkAccess: { allowedDomains: ['*'] }, secret: 'discard-this' }));
  await configurePluginRegistration(directory, source);
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.local', 'figma-plugin.json'), 'utf8')), { id: '123456789' });
  assert.deepEqual(await configuredPluginManifest(directory, manifest), { ...manifest, id: '123456789' });
  await writeFile(source, JSON.stringify({ id: 'not-generated' }));
  await assert.rejects(configurePluginRegistration(directory, source), /numeric plugin ID/);
  assert.deepEqual(await configuredPluginManifest(directory, manifest), { ...manifest, id: '123456789' });
});

test('malformed local registration fails rather than silently building an unregistered plugin', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'figma-registration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.local'));
  for (const invalid of ['not-json', '{}', '{"id":"123","networkAccess":{}}']) {
    await writeFile(join(directory, '.local', 'figma-plugin.json'), invalid);
    await assert.rejects(configuredPluginManifest(directory, {}), /Invalid .local/);
  }
});
