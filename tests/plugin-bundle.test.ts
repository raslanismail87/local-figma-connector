import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

test('production plugin bundle passes sandbox source checks and starts without browser globals', async () => {
  const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/build.ts'], { cwd: projectDirectory });
  const [source, html] = await Promise.all([
    readFile(new URL('../dist/plugin/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/plugin/ui.html', import.meta.url), 'utf8')
  ]);

  const uiScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(uiScript, 'The generated UI must contain an inline script');
  for (const [label, script] of [['main bundle', source], ['UI script', uiScript]]) {
    assert.doesNotMatch(script, /(^|[^.]|\.\.\.)\bimport(\s*(?:\(|\/[/*]))/, `${label}: Figma rejects apparent dynamic imports even inside dependency comments`);
    assert.doesNotMatch(script, /(^|[^.])\beval(\s*\()/, `${label}: Figma rejects apparent direct eval expressions`);
    assert.doesNotMatch(script, /<!--|-->/, `${label}: Figma rejects apparent HTML comments in sandbox source`);
  }

  const shown: string[] = [];
  const messages: unknown[] = [];
  const events: string[] = [];
  const api = {
    root: { name: 'Bundle validation' },
    get fileKey(): never { throw new Error('private API unavailable'); },
    currentPage: { id: 'page', name: 'Page 1', selection: [] },
    showUI: (content: string) => { shown.push(content); },
    on: (event: string) => { events.push(event); },
    ui: {
      onmessage: undefined as undefined | ((message: unknown) => void),
      postMessage: (message: unknown) => { messages.push(message); }
    }
  };

  runInNewContext(source, {
    figma: api,
    __html__: html,
    TextEncoder: undefined,
    TextDecoder: undefined,
    URL: undefined,
    File: undefined,
    Blob: undefined,
    fetch: undefined,
    window: undefined,
    document: undefined,
    navigator: undefined,
    WebSocket: undefined,
    setTimeout: undefined
  }, { filename: 'dist/plugin/main.js', timeout: 5000 });

  assert.deepEqual(shown, [html]);
  assert.deepEqual(events, ['selectionchange', 'currentpagechange']);
  assert.equal(typeof api.ui.onmessage, 'function');
  api.ui.onmessage!({ type: 'ready' });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{
    type: 'document',
    document: {
      name: 'Bundle validation', fileKey: null, pageId: 'page', pageName: 'Page 1', selection: [], selectionCount: 0
    }
  }]);
});
