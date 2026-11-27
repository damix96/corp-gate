import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RuntimeSettings } from '../../src/runtime/settings.js';
import { AutostartInstaller } from '../../src/setup/autostart.js';
import { CommandRunner } from '../../src/setup/commands.js';
import { HostCommand } from '../../src/setup/host-command.js';
import { UnixLaunch } from '../../src/setup/unix-launch.js';
import { WindowsTask } from '../../src/setup/windows-task.js';
import { WindowsShortcut } from '../../src/setup/windows-shortcut.js';

class AutostartTests {
  public run = (): void => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpgate-autostart-'));
    const settings = new RuntimeSettings({ dataDir: path.join(root, "space & percent %TEMP% '"), port: 43234 });
    const commands: Array<{ file: string; args: string[] }> = [];
    const tasks = new Map<string, string>();
    let registry = '';
    const run: CommandRunner = (file, args) => {
      commands.push({ file, args });
      if (file === 'whoami.exe') return { ok: true, output: '"user","S-1-5-21-12345-1001"', status: 0 };
      if (file === 'reg.exe') { if (args[0] === 'add') registry = args[args.indexOf('/d') + 1]; if (args[0] === 'delete') registry = ''; return { ok: args[0] !== 'query' || Boolean(registry), output: registry, status: registry || args[0] !== 'query' ? 0 : 1 }; }
      const name = args[args.indexOf('/TN') + 1];
      if (file === 'schtasks.exe') {
        if (args[0] === '/Create') tasks.set(name, readFileSync(args[args.indexOf('/XML') + 1], 'utf16le').replace(/^\uFEFF/, ''));
        if (args[0] === '/Delete') tasks.delete(name);
        return { ok: args[0] !== '/Query' || tasks.has(name), output: tasks.get(name) || '', status: 0 };
      }
      return { ok: true, output: 'active', status: 0 };
    };
    try {
      const env = { ...process.env, APPDATA: path.join(root, 'appdata'), PATH: '/usr/bin:/opt/node/bin', DISPLAY: ':1' };
      const registryMode = new AutostartInstaller(settings, run, 'win32', env, root);
      assert.equal(registryMode.install('registry').changed, true);
      assert.equal(registryMode.install('registry').changed, false);
      assert.ok(registry.includes('npx -y corp-gate start --host-settings'));
      assert.ok(!registry.includes('powershell') && !registry.includes('node.exe') && !registry.includes('%TEMP%'));
      assert.equal(registryMode.install('off').changed, true);
      assert.equal(registryMode.install('off').changed, false);
      const scheduler = new AutostartInstaller(settings, run, 'win32', env, root);
      assert.equal(scheduler.install('scheduler').changed, true);
      assert.equal(scheduler.install('scheduler').changed, false);
      assert.equal(scheduler.install('off').changed, true);
      new WindowsTask(settings, run).start();
      assert.ok([...tasks.values()].every(xml => xml.includes('<LogonType>InteractiveToken</LogonType>') && !xml.includes('<LogonTrigger>')));
      const calls = commands.length;
      const denied = new AutostartInstaller(settings, () => ({ ok: false, output: '', status: 5 }), 'win32', env, root);
      assert.throws(() => denied.install('registry'), /denied or failed/);
      assert.equal(commands.length, calls);
      const unix = new UnixLaunch(settings, run, env, root);
      for (const mode of ['xdg', 'systemd', 'launchagent'] as const) {
        assert.ok(unix.content(mode).includes(mode === 'launchagent' ? '<string>npx</string><string>-y</string><string>corp-gate</string>' : 'npx -y corp-gate start --host-settings'));
        assert.equal(unix.install(mode), true);
        assert.equal(unix.install(mode), false);
        assert.equal(unix.remove(mode), true);
      }
      assert.equal(HostCommand.decode(HostCommand.settings(settings)).dataDir, settings.dataDir);
      if (process.platform === 'win32') {
        const target = path.join(root, 'actual shortcut.lnk');
        const shortcuts = new WindowsShortcut();
        const definition = { executable: process.env.ComSpec!, arguments: '/d /s /c "npx --version"', workingDirectory: root, windowStyle: 7 };
        shortcuts.write(target, definition);
        assert.equal(shortcuts.equal(shortcuts.inspect(target), definition), true);
        assert.equal(existsSync(target), true);
      }
      console.log('PASS autostart: no-PS npx command, idempotent registry/task/files, only owned removal, policy denial no fallback, strict host settings; real temporary Windows shortcut serialization');
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

new AutostartTests().run();
