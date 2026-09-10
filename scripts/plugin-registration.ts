import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const registrationSchema = z.object({ id: z.string().regex(/^[1-9][0-9]{0,63}$/) }).strict();

export async function readPluginRegistration(directory: string): Promise<{ id: string } | undefined> {
  let contents: string;
  try { contents = await readFile(join(directory, '.local', 'figma-plugin.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try { return registrationSchema.parse(JSON.parse(contents)); }
  catch { throw new Error('Invalid .local/figma-plugin.json. Run npm run plugin:configure with a Figma-generated manifest.'); }
}

export async function configurePluginRegistration(directory: string, manifestPath: string): Promise<void> {
  let registration: { id: string };
  try {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    registration = registrationSchema.parse({ id: typeof manifest === 'object' && manifest !== null && 'id' in manifest ? manifest.id : undefined });
  } catch { throw new Error('Expected a readable Figma-generated manifest.json with a numeric plugin ID.'); }
  const local = join(directory, '.local');
  await mkdir(local, { recursive: true });
  const temporary = join(local, `figma-plugin-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, join(local, 'figma-plugin.json'));
}

export async function configuredPluginManifest(directory: string, manifest: Record<string, unknown>): Promise<Record<string, unknown>> {
  const registration = await readPluginRegistration(directory);
  return registration ? { ...manifest, id: registration.id } : manifest;
}
