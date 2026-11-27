import { RuntimeArguments } from './arguments.js';
import { RuntimeOptions, RuntimeSettings } from './settings.js';
import { CorpGateRuntime } from './service.js';
import { RuntimeLauncher } from './launcher.js';
import { SetupCommand } from '../setup/command.js';
import { AutostartCommand } from '../setup/autostart-command.js';
import { RuntimeDiagnostics } from './diagnostics.js';
import { RuntimeProbe } from './probe.js';
import { RuntimeCredentials } from './credentials.js';
import { SecretInputBrowser } from '../secret-input/browser-launcher.js';

export interface RuntimeCommands {
  createRuntime: (settings: RuntimeSettings) => CorpGateRuntime | Promise<CorpGateRuntime>;
  startBridge: (settings: RuntimeSettings) => Promise<void>;
}

export class RuntimeCommand {
  constructor(private commands: RuntimeCommands) {}

  public run = async (input = process.argv.slice(2), defaults: RuntimeOptions = {}): Promise<void> => {
    const args = new RuntimeArguments(input, defaults);
    if (args.values.help) {
      console.log('npx corp-gate <start|stop|restart|status|open|doctor|probe|setup|autostart|mcp-bridge> [--port N] [--data-dir PATH] [--db PATH]\nsetup [--client codex|claude|cursor] prints instructions only\nautostart [shortcut|scheduler|registry|launchagent|xdg|systemd|off] offers methods for this OS\nprobe --connection PREFIX --model MODEL --api-format anthropic|openai [--endpoint PATH] [--credential-env NAME --credential-header authorization|x-api-key --credential-prefix PREFIX]');
      return;
    }
    if (args.command === 'setup') { new SetupCommand().run(args); return; }
    if (args.command === 'autostart') { await new AutostartCommand(args.settings).run(args.selection); return; }
    if (args.command === 'doctor') { const result = await new RuntimeDiagnostics(args.settings).doctor(); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; return; }
    if (args.command === 'probe') {
      const result = await new RuntimeProbe(args.settings).run({ connection: args.values.connection, model: args.values.model, format: args.values['api-format'], endpoint: args.values.endpoint, credentialEnv: args.values['credential-env'], credentialHeader: args.values['credential-header'], credentialPrefix: args.values['credential-prefix'] });
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (args.command === 'start' && args.values['host-settings']) { await this.serve(args.settings); return; }
    if (args.command === 'serve') { await this.serve(args.settings); return; }
    if (args.command === 'mcp-bridge' || args.command === 'mcp') { await this.commands.startBridge(args.settings); return; }
    const launcher = new RuntimeLauncher(args.settings);
    if (args.command === 'open') {
      await launcher.ensure();
      const adminToken = new RuntimeCredentials(args.settings).readAdminToken();
      const launch = await new SecretInputBrowser().open(new URL(args.settings.url + '/?token=' + adminToken));
      console.log(JSON.stringify({ url: args.settings.url, launch }));
      return;
    }
    if (args.command === 'restart') { await launcher.stop(); console.log(JSON.stringify(await launcher.ensure())); return; }
    if (args.command === 'start' || args.command === 'ensure-start') { console.log(JSON.stringify(await launcher.ensure(Boolean(args.values.force), Date.now() - Math.round(process.uptime() * 1000)))); return; }
    if (args.command === 'status') { console.log(JSON.stringify(await launcher.status() ?? { state: 'stopped' })); return; }
    if (args.command === 'stop') { console.log(JSON.stringify({ stopped: await launcher.stop() })); return; }
    throw new Error('Unknown CorpGate command');
  };

  private serve = async (settings: RuntimeSettings): Promise<void> => {
    const runtime = await this.commands.createRuntime(settings);
    const stop = (): void => { void runtime.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const identity = await runtime.start();
      if (process.send) process.send({ type: 'ready' });
      else console.log(JSON.stringify(identity));
    } catch (error) {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      const code = (error as { code?: string }).code;
      if (process.send) process.send({ type: 'error', code });
      else console.error(code === 'EADDRINUSE' ? 'Port already in use' : 'CorpGate startup failed');
      process.exitCode = code === 'EADDRINUSE' ? 2 : 1;
    } finally { if (process.connected) process.disconnect(); }
  };
}
