import { spawn } from 'node:child_process';
import { ConnectorError } from '../errors.js';

type ClipboardCommand = { executable: string; args: string[] };

function commands(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ClipboardCommand[] {
  if (platform === 'darwin') return [{ executable: 'pbcopy', args: [] }];
  if (platform === 'win32') return [{ executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'] }];
  if (platform === 'linux') return [
    ...(env.WAYLAND_DISPLAY ? [{ executable: 'wl-copy', args: [] }] : []),
    ...(env.DISPLAY ? [{ executable: 'xclip', args: ['-selection', 'clipboard'] }, { executable: 'xsel', args: ['--clipboard', '--input'] }] : []),
  ];
  return [];
}

async function copyWith(command: ClipboardCommand, value: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Clipboard command timed out')); }, 5000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.stdin.once('error', fail);
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Clipboard command failed'));
    });
    child.stdin.end(value);
  });
}

export async function copyToClipboard(value: string, { platform = process.platform, env = process.env }: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  for (const command of commands(platform, env)) {
    try { await copyWith(command, value, env); return; }
    catch {}
  }
  throw new ConnectorError('MANUAL_PAIRING', 'Clipboard unavailable. Copy the private token file contents into the plugin. On Linux, install wl-clipboard for Wayland or xclip/xsel for X11. Do not paste the key into chat.');
}
