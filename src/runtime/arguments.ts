import { parseArgs } from 'node:util';
import { RuntimeOptions, RuntimeSettings } from './settings.js';
import { HostCommand } from '../setup/host-command.js';

export class RuntimeArguments {
  public command: string;
  public settings: RuntimeSettings;
  public values: ReturnType<typeof RuntimeArguments.parse>['values'];
  public selection?: string;

  constructor(args = process.argv.slice(2), defaults: RuntimeOptions = {}) {
    const parsed = RuntimeArguments.parse(args);
    this.command = parsed.positionals[0] ?? 'ensure-start';
    if (parsed.positionals.length > (this.command === 'autostart' ? 2 : 1)) throw new Error('Unexpected positional arguments');
    this.selection = parsed.positionals[1];
    this.values = parsed.values;
    if (parsed.values['host-settings'] && (parsed.values.port || parsed.values['data-dir'] || parsed.values.db)) throw new Error('Host settings cannot be combined with --port, --data-dir or --db.');
    if (parsed.values['host-settings'] && !['start', 'mcp-bridge', 'mcp'].includes(this.command)) throw new Error('Host launch settings are only valid for start and MCP bridge.');
    this.settings = parsed.values['host-settings'] ? HostCommand.decode(parsed.values['host-settings']) : new RuntimeSettings({ ...defaults, ...(parsed.values['data-dir'] ? { dataDir: parsed.values['data-dir'] } : {}), ...(parsed.values.db ? { databasePath: parsed.values.db } : {}), ...(parsed.values.port ? { port: Number(parsed.values.port) } : {}) });
  }

  private static parse = (args: string[]) => parseArgs({ args: args.map(arg => arg === '-force' ? '--force' : arg), allowPositionals: true, options: {
    'data-dir': { type: 'string' }, db: { type: 'string' }, port: { type: 'string' }, force: { type: 'boolean' },
    client: { type: 'string' }, config: { type: 'string' }, 'dry-run': { type: 'boolean' }, autostart: { type: 'boolean' },
    apply: { type: 'boolean' }, target: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    yes: { type: 'boolean', short: 'y' }, json: { type: 'boolean' }, cwd: { type: 'string' },
    'host-settings': { type: 'string' }, connection: { type: 'string' }, model: { type: 'string' }, 'api-format': { type: 'string' }, endpoint: { type: 'string' },
    'credential-env': { type: 'string' }, 'credential-header': { type: 'string' }, 'credential-prefix': { type: 'string' },
  } });
}
