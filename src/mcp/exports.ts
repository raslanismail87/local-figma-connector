import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { exportResultSchema } from '../protocol.js';
import { ConnectorError } from '../errors.js';

export async function exportContent(data: unknown, directory: string): Promise<CallToolResult> {
  const parsed = exportResultSchema.safeParse(data);
  if (!parsed.success) throw new ConnectorError('INVALID_EXPORT', 'Plugin returned invalid export metadata.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const content: CallToolResult['content'] = [];
  const metadata = [];
  for (const item of parsed.data.exports) {
    if ((item.format === 'PNG') !== (item.mimeType === 'image/png') || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)) throw new ConnectorError('INVALID_EXPORT', 'Invalid export encoding or MIME type.');
    const bytes = Buffer.from(item.base64, 'base64');
    if (item.format === 'PNG' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ConnectorError('INVALID_EXPORT', 'PNG signature is missing.');
    if (item.format === 'SVG' && !/<svg[\s>]/.test(bytes.toString('utf8'))) throw new ConnectorError('INVALID_EXPORT', 'SVG root is missing.');
    const path = join(directory, `${randomUUID()}.${item.format.toLowerCase()}`);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const { base64, ...details } = item;
    metadata.push({ ...details, path, bytes: bytes.length });
    if (item.format === 'PNG') content.push({ type: 'image', data: base64, mimeType: 'image/png' });
    content.push({ type: 'resource_link', uri: pathToFileURL(path).href, name: item.name, mimeType: item.mimeType, size: bytes.length });
  }
  const structuredContent = { exports: metadata };
  content.unshift({ type: 'text', text: JSON.stringify(structuredContent) });
  return { content, structuredContent };
}
