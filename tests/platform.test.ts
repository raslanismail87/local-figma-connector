import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromeCandidates, findChromeExecutable } from '../src/platform/chrome.js';
import { copyToClipboard } from '../src/platform/clipboard.js';

test('an explicit Chrome path is honored, including spaces, without falling back on a typo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector chrome '));
  try {
    const executable = join(directory, 'custom browser');
    await writeFile(executable, '', { mode: 0o700 });
    assert.equal(await findChromeExecutable({ env: { CHROME_EXECUTABLE: executable } }), executable);
    await assert.rejects(findChromeExecutable({ env: { CHROME_EXECUTABLE: join(directory, 'missing') } }), /CHROME_EXECUTABLE/);
    await assert.rejects(findChromeExecutable({ env: { CHROME_EXECUTABLE: directory } }), /CHROME_EXECUTABLE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Chrome discovery checks local installation roots on Windows and the user Applications directory on macOS', () => {
  assert.deepEqual(chromeCandidates({ platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' } }), [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\Example\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ]);
  assert.ok(chromeCandidates({ platform: 'darwin', env: {}, home: '/home/example' }).includes('/home/example/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
});

test('Linux discovery skips missing browsers and finds an executable on PATH', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector-browser-'));
  try {
    const executable = join(directory, 'chromium');
    await writeFile(executable, '', { mode: 0o700 });
    assert.equal(await findChromeExecutable({ platform: 'linux', env: { PATH: directory } }), executable);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pairing passes the key over stdin and falls back to an available Linux clipboard tool', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector-clipboard-'));
  try {
    const output = join(directory, 'clipboard');
    await writeFile(join(directory, 'xclip'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CLIPBOARD_OUTPUT.args"\n/bin/cat > "$CLIPBOARD_OUTPUT"\n', { mode: 0o700 });
    const value = 'a'.repeat(64);
    await copyToClipboard(value, { platform: 'linux', env: { PATH: directory, WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', CLIPBOARD_OUTPUT: output } });
    assert.equal(await readFile(output, 'utf8'), value);
    assert.equal(await readFile(`${output}.args`, 'utf8'), '-selection\nclipboard\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('headless pairing gives manual guidance without exposing the secret', async () => {
  const value = 'b'.repeat(64);
  await assert.rejects(copyToClipboard(value, { platform: 'linux', env: {} }), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'MANUAL_PAIRING');
    assert.match(error.message, /private token file/);
    assert.equal(error.message.includes(value), false);
    return true;
  });
});
