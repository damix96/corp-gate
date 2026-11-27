import { execFile } from 'node:child_process';
import path from 'node:path';

export type BrowserLaunchResult = 'attempted' | 'unavailable';
export interface BrowserCommand { file: string; args: string[]; env: NodeJS.ProcessEnv }
export type BrowserCommandRunner = (command: BrowserCommand) => Promise<boolean>;

export class SecretInputBrowser {
  constructor(private platform = process.platform, private run: BrowserCommandRunner = SecretInputBrowser.execute) {}

  public open = async (address: URL): Promise<BrowserLaunchResult> => {
    const command = this.command(address);
    if (!command) return 'unavailable';
    try { return await this.run(command) ? 'attempted' : 'unavailable'; }
    catch { return 'unavailable'; }
  };

  public command = (address: URL): BrowserCommand | undefined => {
    if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.username || address.password) return;
    const isDashboard = ['/', '/dashboard', '/vault', '/rules'].includes(address.pathname);
    const validHash = ['', '#overview', '#vault', '#rules', '#secrets'].includes(address.hash);
    if (!validHash) return;
    if (isDashboard) {
      const keys = [...address.searchParams.keys()];
      if (keys.some(key => key !== 'token') || address.searchParams.getAll('token').length > 1) return;
      const token = address.searchParams.get('token');
      if (token !== null && !/^[a-f0-9]{64}$/.test(token)) return;
    } else {
      if (address.hash) return;
      if (!/^\/vault\/set(?:\/[a-zA-Z0-9_-]{4,36})?$/.test(address.pathname)) return;
      if ([...address.searchParams.keys()].some(key => key !== 'request' && key !== 'secrets')) return;
      if (['request', 'secrets'].some(key => address.searchParams.getAll(key).length > 1)) return;
      const request = address.searchParams.get('request');
      const names = address.searchParams.get('secrets');
      if (request && !/^[a-zA-Z0-9_-]{4,36}$/.test(request)) return;
      if (names && !/^[A-Z0-9_]+(?:,[A-Z0-9_]+)*$/.test(names)) return;
    }
    if (address.href.length > 8192) return;
    const env: NodeJS.ProcessEnv = { ...process.env, CORPGATE_INPUT_URL: address.href };
    if (this.platform === 'win32') {
      const query = [...address.searchParams.entries()].map(([key, value]) => key + '=' + value).join('&');
      const target = address.origin + address.pathname + (query ? '?' + query : '') + address.hash;
      return {
        file: process.env.ComSpec || path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
        args: ['/d', '/s', '/c', 'start "" "' + target + '"'],
        env,
      };
    }
    if (this.platform === 'darwin') return { file: '/usr/bin/open', args: [address.href], env };
    if (this.platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY)) return { file: '/usr/bin/xdg-open', args: [address.href], env };
    return undefined;
  };

  private static execute: BrowserCommandRunner = command => new Promise(resolve => {
    const child = execFile(command.file, command.args, { env: command.env, windowsHide: true, timeout: 5000, maxBuffer: 1024, shell: false, detached: true } as any, (error: Error | null) => resolve(!error));
    child?.unref?.();
  });
}
