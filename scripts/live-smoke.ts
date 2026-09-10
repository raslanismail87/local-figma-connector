import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { documentSchema, mutationResultSchema, readResultSchema } from '../src/protocol.js';

const argv = process.argv.slice(2);
function option(name: string) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
const expectedDocument = option('--document');
const sessionIdOption = option('--session');
const reportPath = resolve('artifacts', `live-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const report: { status: string; verifiedInFigma: boolean; steps: unknown[]; error?: string } = { status: 'running', verifiedInFigma: false, steps: [] };
const client = new Client({ name: 'local-figma-live-smoke', version: '1.0.0' });
async function save() { await mkdir(resolve('artifacts'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); }
async function call(name: string, args: Record<string, unknown> = {}) {
  report.steps.push({ tool: name, arguments: args, status: 'submitted' });
  await save();
  const reply = await client.callTool({ name, arguments: args }) as CallToolResult;
  if (reply.isError) throw new Error(reply.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
  report.steps.push({ tool: name, status: 'completed', result: reply.structuredContent });
  await save();
  return reply;
}
function data(reply: CallToolResult) { return z.object({ result: z.object({ requestId: z.uuid(), data: z.unknown() }) }).parse(reply.structuredContent).result.data; }

try {
  if (!expectedDocument) throw new Error("Provide --document 'Codex Connector Smoke Test' and use a disposable Figma Design file with that exact name.");
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp.js')], stderr: 'inherit' }));
  const listed = await call('figma_sessions');
  const sessions = z.object({ result: z.object({ sessions: z.array(z.object({ id: z.string(), document: documentSchema })) }) }).parse(listed.structuredContent).result.sessions;
  if (sessions.length === 0) throw new Error('LIVE_FIGMA_BLOCKED: no plugin is paired. Install/open Figma desktop, import dist/plugin/manifest.json, run the plugin and pair with npm run pair.');
  if (!sessionIdOption && sessions.length > 1) throw new Error('Multiple sessions are connected. Supply --session with the intended session ID.');
  const session = sessionIdOption ? sessions.find(item => item.id === sessionIdOption) : sessions[0];
  if (!session) throw new Error('Selected session is no longer connected. List sessions again.');
  if (session.document.name !== expectedDocument) throw new Error('The selected document name does not match --document. No edits were submitted.');
  const target = { sessionId: session.id };
  const selection = documentSchema.parse(data(await call('figma_selection', target)));
  if (selection.name !== expectedDocument) throw new Error('Document changed during preflight. No edits were submitted.');
  if (!selection.selectionCount) throw new Error('Draw and select a small rectangle in the disposable file, then run the smoke check again. No edits were submitted.');
  const initial = readResultSchema.parse(data(await call('figma_read_nodes', { ...target, depth: 1, maxNodes: 10 })));
  assert.ok(initial.nodes.length > 0);
  await call('figma_export_nodes', { ...target, nodeIds: [initial.nodes[0].id], format: 'PNG' });
  const frame = mutationResultSchema.parse(data(await call('figma_create_node', {
    ...target, mutationId: randomUUID(), type: 'FRAME', properties: {
      name: `Connector smoke ${new Date().toISOString()}`, x: 100, y: 100, width: 400, height: 240,
      fills: [{ r: 0.96, g: 0.97, b: 0.98 }], autoLayout: { layoutMode: 'VERTICAL', paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24, itemSpacing: 12, primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' }
    }
  })));
  const text = mutationResultSchema.parse(data(await call('figma_create_node', {
    ...target, mutationId: randomUUID(), type: 'TEXT', parentId: frame.nodeId,
    properties: { name: 'Connector status', characters: 'Hello from Codex', font: { family: 'Inter', style: 'Regular' }, fontSize: 24, fills: [{ r: 0.08, g: 0.1, b: 0.12 }] }
  })));
  await call('figma_update_node', { ...target, mutationId: randomUUID(), nodeId: frame.nodeId, properties: { name: 'Connector smoke verified', width: 440, fills: [{ r: 0.92, g: 0.97, b: 0.94 }] } });
  await call('figma_update_node', { ...target, mutationId: randomUUID(), nodeId: text.nodeId, properties: { characters: 'Connected locally', fontSize: 28 } });
  const updated = readResultSchema.parse(data(await call('figma_read_nodes', { ...target, nodeIds: [frame.nodeId, text.nodeId], depth: 0 })));
  assert.equal(updated.nodes[0].name, 'Connector smoke verified');
  assert.equal(updated.nodes[0].width, 440);
  assert.equal(updated.nodes[1].characters, 'Connected locally');
  assert.equal(updated.nodes[1].fontSize, 28);
  await call('figma_export_nodes', { ...target, nodeIds: [frame.nodeId], format: 'PNG' });
  await call('figma_export_nodes', { ...target, nodeIds: [frame.nodeId], format: 'SVG' });
  report.status = 'passed';
  report.verifiedInFigma = true;
  process.stdout.write(`Live Figma smoke passed. Created frame ${frame.nodeId} and text ${text.nodeId}. Inspect the previews listed in ${reportPath}. Remove the disposable file when finished.\n`);
} catch (error) {
  report.status = 'blocked-or-failed';
  report.error = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${report.error}\nReport: ${reportPath}\nNo mutation is automatically retried. Inspect recorded attempts before running again.\n`);
  process.exitCode = 1;
} finally { await save(); await client.close(); }
