import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

type ChromeEnvironment = { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string };

export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir() }: ChromeEnvironment = {}): string[] {
  if (env.CHROME_EXECUTABLE) return [env.CHROME_EXECUTABLE];
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    posix.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  if (platform === 'win32') return [...new Set([env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((root): root is string => Boolean(root)))]
    .map(root => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return (env.PATH ?? '').split(posix.delimiter).filter(Boolean)
    .flatMap(directory => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(name => posix.join(directory, name)));
}

export async function findChromeExecutable(options: ChromeEnvironment = {}): Promise<string> {
  for (const candidate of chromeCandidates(options)) {
    try {
      await access(candidate, (options.platform ?? process.platform) === 'win32' ? constants.F_OK : constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  throw new Error('Chrome or Chromium was not found. Install it or set CHROME_EXECUTABLE to its executable path.');
}
