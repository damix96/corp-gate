import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface ShortcutDefinition { executable: string; arguments: string; workingDirectory: string; windowStyle: number }

export class WindowsShortcut {
  private executable = path.join(path.dirname(createRequire(import.meta.url).resolve('windows-shortcuts')), 'shortcut', 'Shortcut.exe');
  public equal = (left: ShortcutDefinition | undefined, right: ShortcutDefinition): boolean => Boolean(left && path.win32.normalize(left.executable).toLowerCase() === path.win32.normalize(right.executable).toLowerCase() && path.win32.normalize(left.workingDirectory).toLowerCase() === path.win32.normalize(right.workingDirectory).toLowerCase() && left.arguments === right.arguments && left.windowStyle === right.windowStyle);

  public inspect = (target: string): ShortcutDefinition | undefined => {
    if (!existsSync(target)) return undefined;
    const output = this.execute(['/A:Q', '/F:' + target]);
    const values = Object.fromEntries(output.split(/\r?\n/).flatMap(line => { const index = line.indexOf('='); return index < 0 ? [] : [[line.slice(0, index), line.slice(index + 1)]]; }));
    return { executable: values.TargetPathExpanded || values.TargetPath || '', arguments: values.Arguments || '', workingDirectory: values.WorkingDirectoryExpanded || values.WorkingDirectory || '', windowStyle: Number(values.RunStyle || 1) };
  };

  public write = (target: string, definition: ShortcutDefinition): void => {
    this.execute(['/A:C', '/F:' + target, '/T:' + definition.executable, '/P:' + definition.arguments, '/W:' + definition.workingDirectory, '/R:' + definition.windowStyle, '/D:CorpGate user login']);
  };

  public execute = (args: string[]): string => {
    if (process.platform !== 'win32') throw new Error('Windows shortcuts are unavailable on this platform');
    const result = spawnSync(this.executable, args, { encoding: 'utf8', windowsHide: true, timeout: 10000, shell: false });
    if (result.error || result.status !== 0) throw new Error('Windows startup shortcut could not be created or inspected; no operating-system feature was enabled');
    return result.stdout.trim();
  };
}
