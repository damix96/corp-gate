import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeSettings } from '../../src/runtime/settings.js';
import { WindowsTask } from '../../src/setup/windows-task.js';
import { HostCommand } from '../../src/setup/host-command.js';
import { SystemCommands } from '../../src/setup/commands.js';

class NativeLaunchTests {
  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP Windows interactive scheduler native test on this OS'); return; }
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpgate-native-task-'));
    const settings = new RuntimeSettings({ dataDir: path.join(root, 'data'), port: 43234 });
    const task = new WindowsTask(settings);
    const name = task.name(false) + '-Probe';
    const file = path.join(root, 'probe.xml');
    const marker = path.join(root, 'npx-version.txt');
    let registered = false;
    try {
      assert.equal(task.install(false), true);
      assert.equal(task.install(false), false);
      const xml = task.definition(false).replace(/<Arguments>[^<]*<\/Arguments>/, '<Arguments>' + HostCommand.xml('/d /s /c "npx --version > "' + marker + '""') + '</Arguments>');
      writeFileSync(file, '\uFEFF' + xml, 'utf16le');
      SystemCommands.require(SystemCommands.run, 'schtasks.exe', ['/Create', '/TN', name, '/XML', file, '/F'], 'Temporary native task registration failed.');
      registered = true;
      SystemCommands.require(SystemCommands.run, 'schtasks.exe', ['/Run', '/TN', name], 'Temporary native task launch failed.');
      const deadline = Date.now() + 15000;
      while ((!existsSync(marker) || !readFileSync(marker, 'utf8').trim()) && Date.now() < deadline) await delay(100);
      assert.ok(existsSync(marker), 'Task must execute npx from the OS user-session PATH');
      assert.match(readFileSync(marker, 'utf8').trim(), /^\d+\.\d+\.\d+/);
      console.log('PASS native Windows: real interactive least-privilege task registration/idempotency, ordinary npx from scheduler PATH, no login trigger or user autostart changes');
    } finally {
      if (registered) SystemCommands.require(SystemCommands.run, 'schtasks.exe', ['/Delete', '/TN', name, '/F'], 'Temporary native task cleanup failed.');
      task.remove(false);
      try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
    }
  };
}

await new NativeLaunchTests().run();
