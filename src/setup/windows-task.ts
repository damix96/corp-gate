import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RuntimeSettings } from '../runtime/settings.js';
import { HostCommand } from './host-command.js';
import { CommandRunner, SystemCommands } from './commands.js';

export class WindowsTask {
  constructor(private settings: RuntimeSettings, private run: CommandRunner = SystemCommands.run) {}
  public name = (login = false): string => 'CorpGate-' + (login ? 'Autostart-' : 'Start-') + createHash('sha256').update(this.settings.dataDir + '|' + this.settings.port).digest('hex').slice(0, 16);
  public definition = (login = false): string => {
    const user = this.user();
    const xml = HostCommand.xml;
    const command = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\cmd.exe';
    return '<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>CorpGate user-session launch</Description></RegistrationInfo><Triggers>' + (login ? '<LogonTrigger><Enabled>true</Enabled><UserId>' + xml(user) + '</UserId></LogonTrigger>' : '') + '</Triggers><Principals><Principal id="User"><UserId>' + xml(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="User"><Exec><Command>' + xml(command) + '</Command><Arguments>' + xml('/d /s /c "' + HostCommand.shell(this.settings) + '"') + '</Arguments></Exec></Actions></Task>';
  };
  public install = (login = false): boolean => {
    const definition = this.definition(login);
    const existing = this.run('schtasks.exe', ['/Query', '/TN', this.name(login), '/XML']);
    if (existing.ok && this.matches(existing.output, definition)) return false;
    if (existing.ok && !existing.output.includes('CorpGate user-session launch')) throw new Error('The task name is already used by another application. No task was changed.');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'corpgate-task-'));
    const file = path.join(directory, 'task.xml');
    try {
      writeFileSync(file, '\uFEFF' + definition, 'utf16le');
      SystemCommands.require(this.run, 'schtasks.exe', ['/Create', '/TN', this.name(login), '/XML', file, '/F'], 'Task Scheduler registration was denied or failed. No alternative method was attempted.');
      const saved = SystemCommands.require(this.run, 'schtasks.exe', ['/Query', '/TN', this.name(login), '/XML'], 'Task Scheduler registration could not be verified.');
      if (!this.matches(saved, definition)) throw new Error('Task Scheduler saved a different command or session setting.');
      return true;
    } finally { rmSync(file, { force: true }); rmdirSync(directory); }
  };
  public start = (): void => { this.install(false); SystemCommands.require(this.run, 'schtasks.exe', ['/Run', '/TN', this.name(false)], 'Task Scheduler could not start CorpGate. Check the logged-in user session and task permissions.'); };
  public remove = (login = true): boolean => {
    const task = this.run('schtasks.exe', ['/Query', '/TN', this.name(login), '/XML']);
    if (!task.ok) return false;
    if (!task.output.includes('CorpGate user-session launch') || !this.matches(task.output, this.definition(login))) throw new Error('The saved task was changed outside CorpGate; it was not removed.');
    SystemCommands.require(this.run, 'schtasks.exe', ['/Delete', '/TN', this.name(login), '/F'], 'Task Scheduler could not remove the CorpGate registration.');
    return true;
  };
  private matches = (saved: string, expected: string): boolean => {
    const read = (xml: string, tag: string): string | undefined => xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'))?.[1].replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name]!));
    return ['Command', 'Arguments', 'UserId', 'LogonType', 'RunLevel'].every(tag => {
      const left = read(saved, tag) ?? (tag === 'RunLevel' ? 'LeastPrivilege' : undefined);
      const right = read(expected, tag) ?? (tag === 'RunLevel' ? 'LeastPrivilege' : undefined);
      return tag === 'Command' ? left?.toLowerCase() === right?.toLowerCase() : left === right;
    }) && saved.includes('<LogonTrigger>') === expected.includes('<LogonTrigger>');
  };
  private user = (): string => {
    const user = this.run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
    const sid = user.output.match(/S-1-\d+(?:-\d+)+/i)?.[0];
    if (!user.ok || !sid) throw new Error('Cannot determine the current Windows user for interactive launch.');
    return sid;
  };
}
