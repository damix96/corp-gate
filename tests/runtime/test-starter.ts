import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RuntimeSettings } from '../../src/runtime/settings.js';

export class TestRuntimeStarter {
  constructor(private settings: RuntimeSettings, private entry = path.join(settings.packageRoot, 'dist/runtime/cli.js')) {}
  public start = async (timeout: number): Promise<void> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [this.entry, 'serve', ...this.settings.arguments()], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], cwd: this.settings.packageRoot });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.unref();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('CorpGate startup timed out')); }, timeout);
    child.once('error', () => finish(new Error('Could not launch fixture')));
    child.once('exit', code => finish(code === 0 || code === 2 ? undefined : new Error('Fixture startup failed')));
    child.once('message', message => { const result = message as { type?: string; code?: string }; finish(result.type === 'ready' || result.code === 'EADDRINUSE' ? undefined : new Error('Fixture startup failed')); });
  });
}
