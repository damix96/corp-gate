import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class AutostartFiles {
  public static save = (target: string, content: string, owner: string): boolean => {
    if (existsSync(target)) {
      const previous = readFileSync(target, 'utf8');
      if (previous === content) return false;
      if (!previous.includes(owner)) throw new Error('The autostart file already belongs to another configuration. It was not changed.');
    }
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    try { renameSync(temporary, target); }
    finally { rmSync(temporary, { force: true }); }
    if (readFileSync(target, 'utf8') !== content) throw new Error('Autostart file verification failed.');
    return true;
  };
  public static remove = (target: string, owner: string): boolean => {
    if (!existsSync(target)) return false;
    if (!readFileSync(target, 'utf8').includes(owner)) throw new Error('The autostart file was changed outside CorpGate; it was not removed.');
    rmSync(target);
    return true;
  };
}
