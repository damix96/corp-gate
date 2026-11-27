import { RuntimeSettings } from '../runtime/settings.js';

export class HostCommand {
  public static settings = (settings: RuntimeSettings): string => Buffer.from(JSON.stringify({ dataDir: settings.dataDir, databasePath: settings.databasePath, port: settings.port })).toString('base64url');
  public static decode = (encoded: string): RuntimeSettings => {
    if (!/^[A-Za-z0-9_-]{1,16384}$/.test(encoded)) throw new Error('Invalid host launch settings');
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!value || typeof value.dataDir !== 'string' || typeof value.databasePath !== 'string' || !Number.isInteger(value.port) || Object.keys(value).some(key => !['dataDir', 'databasePath', 'port'].includes(key))) throw new Error('Invalid host launch settings');
    return new RuntimeSettings(value);
  };
  public static args = (settings: RuntimeSettings): string[] => ['-y', 'corp-gate', 'start', '--host-settings', this.settings(settings)];
  public static shell = (settings: RuntimeSettings): string => 'npx ' + this.args(settings).join(' ');
  public static path = (env: NodeJS.ProcessEnv): string => (env.PATH || '/usr/bin:/bin').split(':').filter(entry => entry && !/(?:\/node_modules\/\.bin(?:\/|$)|\/_npx\/)/.test(entry)).join(':');
  public static xml = (value: string): string => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!));
}
