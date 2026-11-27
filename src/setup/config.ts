import { stringify } from 'smol-toml';
import { RuntimeSettings } from '../runtime/settings.js';
import { HostCommand } from './host-command.js';

export type ClientKind = 'claude' | 'cursor' | 'codex';
export interface SetupResult { changed: false; content: string }

export class ClientConfigInstaller {
  constructor(private settings: RuntimeSettings) {}

  public install = (client: ClientKind, target?: string, dryRun?: boolean): SetupResult => {
    if (target !== undefined || dryRun !== undefined) throw new Error('Setup only prints instructions. Edit the chosen client configuration yourself; --config and --dry-run no longer write or preview files.');
    if (!['claude', 'cursor', 'codex'].includes(client)) throw new Error('Supported clients: claude, cursor, codex');
    const args = ['-y', 'corp-gate', 'mcp-bridge', '--host-settings', HostCommand.settings(this.settings)];
    const entry = process.platform === 'win32' ? { command: 'cmd', args: ['/d', '/s', '/c', 'npx ' + args.join(' ')] } : { command: 'npx', args };
    const configuration = client === 'codex' ? { mcp_servers: { corpgate: entry } } : { mcpServers: { corpgate: entry } };
    return { changed: false, content: client === 'codex' ? stringify(configuration) : JSON.stringify(configuration, null, 2) + '\n' };
  };
}
