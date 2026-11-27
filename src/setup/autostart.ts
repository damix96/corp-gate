import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RuntimeSettings } from '../runtime/settings.js';
import { WindowsShortcut, ShortcutDefinition } from './windows-shortcut.js';
import { WindowsTask } from './windows-task.js';
import { UnixLaunch, UnixAutostartMode } from './unix-launch.js';
import { CommandRunner, SystemCommands } from './commands.js';
import { HostCommand } from './host-command.js';
import { AutostartFiles } from './autostart-files.js';

export type AutostartMode = 'shortcut' | 'scheduler' | 'registry' | UnixAutostartMode | 'off';
export interface AutostartResult { mode: AutostartMode; changed: boolean; target?: string; message: string }

export class AutostartInstaller {
  private key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  private state: string;
  private task: WindowsTask;
  private unix: UnixLaunch;
  private owner: string;

  constructor(private settings: RuntimeSettings, private run: CommandRunner = SystemCommands.run, private platform = process.platform, private env: NodeJS.ProcessEnv = process.env, private home = os.homedir(), private shortcuts = new WindowsShortcut()) {
    this.owner = 'CorpGate-' + createHash('sha256').update(settings.dataDir + '|' + settings.port).digest('hex').slice(0, 16);
    this.state = path.join(settings.dataDir, 'autostart.json');
    this.task = new WindowsTask(settings, run);
    this.unix = new UnixLaunch(settings, run, env, home);
  }
  public modes = (): AutostartMode[] => this.platform === 'win32' ? ['shortcut', 'scheduler', 'registry', 'off'] : this.platform === 'darwin' ? ['launchagent', 'off'] : this.platform === 'linux' ? ['xdg', 'systemd', 'off'] : ['off'];
  public current = (): AutostartMode => {
    if (!existsSync(this.state)) return 'off';
    const saved = JSON.parse(readFileSync(this.state, 'utf8'));
    if (saved.owner !== this.owner || !this.modes().includes(saved.mode)) throw new Error('Unknown autostart registration state; no settings were changed.');
    return saved.mode;
  };
  public install = (mode: AutostartMode): AutostartResult => {
    if (!this.modes().includes(mode)) throw new Error('Available autostart methods: ' + this.modes().join(', '));
    const previous = this.current();
    const pending = existsSync(this.state) ? JSON.parse(readFileSync(this.state, 'utf8')).registrations : undefined;
    const registrations: AutostartMode[] = Array.isArray(pending) ? pending.filter((item: unknown) => typeof item === 'string' && this.modes().includes(item as AutostartMode) && item !== 'off') : previous === 'off' ? [] : [previous];
    if (mode === 'off') {
      let changed = false;
      for (const registration of registrations) changed = this.remove(registration) || changed;
      if (existsSync(this.state)) rmSync(this.state);
      return { mode, changed, message: 'Autostart is off. A running server has not been stopped.' };
    }
    const result = mode === 'shortcut' ? this.shortcut() : mode === 'scheduler' ? { changed: this.task.install(true), target: this.task.name(true) } : mode === 'registry' ? this.registry() : { changed: this.unix.install(mode), target: this.unix.target(mode) };
    AutostartFiles.save(this.state, JSON.stringify({ owner: this.owner, mode, registrations: [...new Set([mode, ...registrations])] }) + '\n', this.owner);
    for (const registration of registrations) if (registration !== mode) this.remove(registration);
    AutostartFiles.save(this.state, JSON.stringify({ owner: this.owner, mode, registrations: [mode] }) + '\n', this.owner);
    return { mode, ...result, message: 'Autostart is configured for the next user login. The server has not been started.' };
  };
  private command = (): string => '"' + (this.env.ComSpec || path.win32.join(this.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe')) + '" /d /s /c "' + HostCommand.shell(this.settings) + '"';
  private shortcutTarget = (): string => {
    if (!this.env.APPDATA) throw new Error('APPDATA is required for the current-user Startup folder.');
    return path.join(this.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup/CorpGate.lnk');
  };
  private shortcutDefinition = (): ShortcutDefinition => ({ executable: this.env.ComSpec || path.win32.join(this.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'), arguments: '/d /s /c "' + HostCommand.shell(this.settings) + '"', workingDirectory: this.settings.dataDir, windowStyle: 7 });
  private shortcut = (): { changed: boolean; target: string } => {
    const target = this.shortcutTarget();
    const definition = this.shortcutDefinition();
    const previous = this.shortcuts.inspect(target);
    if (this.shortcuts.equal(previous, definition)) return { changed: false, target };
    if (previous && previous.arguments !== definition.arguments) throw new Error('CorpGate.lnk already points to a different configuration; it was not changed.');
    mkdirSync(path.dirname(target), { recursive: true });
    mkdirSync(this.settings.dataDir, { recursive: true });
    const temporary = path.join(path.dirname(target), this.owner + '-' + randomUUID() + '.lnk');
    try {
      this.shortcuts.write(temporary, definition);
      if (!this.shortcuts.equal(this.shortcuts.inspect(temporary), definition)) throw new Error('Windows shortcut verification failed.');
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
    return { changed: true, target };
  };
  private registry = (): { changed: boolean; target: string } => {
    const query = this.run('reg.exe', ['query', this.key, '/v', this.owner]);
    const command = this.command();
    if (query.ok && query.output.includes(command)) return { changed: false, target: this.key + '\\' + this.owner };
    if (query.ok) throw new Error('The CorpGate Run entry was changed outside CorpGate; it was not overwritten.');
    SystemCommands.require(this.run, 'reg.exe', ['add', this.key, '/v', this.owner, '/t', 'REG_SZ', '/d', command, '/f'], 'Registry autostart registration was denied or failed. No alternative method was attempted.');
    const saved = SystemCommands.require(this.run, 'reg.exe', ['query', this.key, '/v', this.owner], 'Registry autostart registration could not be verified.');
    if (!saved.includes(command)) throw new Error('Registry autostart saved a different command.');
    return { changed: true, target: this.key + '\\' + this.owner };
  };
  private remove = (mode: AutostartMode): boolean => {
    if (mode === 'scheduler') return this.task.remove(true);
    if (mode === 'shortcut') {
      const target = this.shortcutTarget();
      if (!existsSync(target)) return false;
      if (!this.shortcuts.equal(this.shortcuts.inspect(target), this.shortcutDefinition())) throw new Error('The shortcut was changed outside CorpGate; it was not removed.');
      rmSync(target);
      return true;
    }
    if (mode === 'registry') {
      const existing = this.run('reg.exe', ['query', this.key, '/v', this.owner]);
      if (!existing.ok) return false;
      if (!existing.output.includes(this.command())) throw new Error('The registry entry was changed outside CorpGate; it was not removed.');
      SystemCommands.require(this.run, 'reg.exe', ['delete', this.key, '/v', this.owner, '/f'], 'Could not remove the CorpGate Run registration.');
      return true;
    }
    return mode === 'off' ? false : this.unix.remove(mode);
  };
}
