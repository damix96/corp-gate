import { RuntimeArguments } from '../runtime/arguments.js';
import { ClientConfigInstaller, ClientKind } from './config.js';
import { SetupInstructions } from './instructions.js';

export class SetupCommand {
  public run = (args: RuntimeArguments): void => {
    if (['config', 'dry-run', 'autostart', 'apply', 'target'].some(key => args.values[key as keyof typeof args.values] !== undefined)) throw new Error('Setup is output-only. Use npx corp-gate setup [--client codex|claude|cursor]. Choose autostart separately with npx corp-gate autostart.');
    const client = args.values.client;
    if (client && !['claude', 'cursor', 'codex'].includes(client)) throw new Error('Supported clients: claude, cursor, codex');
    console.log(new SetupInstructions(args.settings, new ClientConfigInstaller(args.settings)).render(client as ClientKind | undefined));
  };
}
