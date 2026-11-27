import { spawnSync } from 'node:child_process';

export interface CommandResult { ok: boolean; output: string; status: number | null }
export type CommandRunner = (file: string, args: string[]) => CommandResult;

export class SystemCommands {
  public static run: CommandRunner = (file, args) => {
    const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1048576, shell: false });
    return { ok: !result.error && result.status === 0, output: String(result.stdout || ''), status: result.status };
  };
  public static require = (run: CommandRunner, file: string, args: string[], message: string): string => {
    const result = run(file, args);
    if (!result.ok) throw new Error(message);
    return result.output;
  };
}
