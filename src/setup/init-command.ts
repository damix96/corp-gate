import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { RuntimeArguments } from '../runtime/arguments.js';
import { RuntimeClient } from '../runtime/client.js';
import { RuntimeCredentials } from '../runtime/credentials.js';
import { RuntimeSettings } from '../runtime/settings.js';
import { AppliedEndpointResult, InitEndpointApplier } from './init-applier.js';
import { ClientEndpointDiscovery, DiscoveredEndpoint } from './init-discovery.js';
import { InitRecoveryStore } from './init-recovery.js';

export interface InitCommandDeps {
  homeDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  isTTY?: boolean;
}

export class InitCommand {
  constructor(private settings: RuntimeSettings, private deps: InitCommandDeps = {}) {}

  public run = async (args: RuntimeArguments): Promise<void> => {
    const yes = Boolean(args.values.yes);
    const dryRun = Boolean(args.values['dry-run']);
    const json = Boolean(args.values.json);
    const cwd = args.values.cwd ?? this.deps.cwd ?? process.cwd();
    const discovery = new ClientEndpointDiscovery({
      homeDir: this.deps.homeDir ?? os.homedir(),
      cwd,
      env: this.deps.env ?? process.env,
      corpGatePort: this.settings.port,
    });
    const discovered = discovery.discover();
    if (discovered.length === 0) {
      if (json) console.log(JSON.stringify({ dryRun, discovered: [], results: [] }));
      else console.log('No overridden AI client BASE_URL configurations were found.\nRun npx corp-gate setup for manual setup instructions.');
      return;
    }
    if (dryRun) {
      if (json) console.log(JSON.stringify({ dryRun: true, discovered: discovered.map(item => ({ ...item, corpGateUrl: `${this.settings.url}/${item.suggestedPrefix}` })) }));
      else this.printDryRun(discovered);
      return;
    }
    const isTTY = this.deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let selected = discovered;
    if (!yes) {
      if (!isTTY) throw new Error('Non-interactive terminal detected. Re-run with --yes to import all discovered endpoints or --dry-run to preview.');
      const picked = await this.promptSelection(discovered);
      if (!picked) {
        if (json) console.log(JSON.stringify({ cancelled: true, results: [] }));
        else console.log('Cancelled. No files or routes were modified.');
        return;
      }
      selected = picked;
    }
    if (selected.length === 0) {
      if (json) console.log(JSON.stringify({ cancelled: false, results: [] }));
      else console.log('No endpoints selected. Nothing was changed.');
      return;
    }
    const client = new RuntimeClient(this.settings);
    const runtime = await client.inspect().catch(() => undefined);
    if (runtime?.identity.state !== 'ready') throw new Error('CorpGate is not running. Start it first with: npx -y corp-gate start');
    const adminToken = new RuntimeCredentials(this.settings).readAdminToken();
    const recovery = new InitRecoveryStore(this.settings.dataDir);
    const applier = new InitEndpointApplier({
      settings: this.settings,
      recovery,
      adminToken,
      fetchImpl: this.deps.fetchImpl,
      platform: this.deps.platform,
    });
    const results = await applier.apply(selected);
    if (json) console.log(JSON.stringify({ dryRun: false, recoveryDoc: recovery.recoveryDocPath, results }));
    else this.printSummary(results, recovery.recoveryDocPath);
  };

  public restore = async (args: RuntimeArguments): Promise<void> => {
    const json = Boolean(args.values.json);
    const recovery = new InitRecoveryStore(this.settings.dataDir);
    const report = recovery.restore();
    if (json) {
      console.log(JSON.stringify(report));
      if (report.failed.length > 0) process.exitCode = 1;
      return;
    }
    if (report.restored.length === 0 && report.skipped.length === 0 && report.failed.length === 0) {
      console.log('No CorpGate init backups found in ' + recovery.manifestPath);
      return;
    }
    for (const item of report.restored) console.log(`Restored: ${item.filePath} <- ${item.backupPath}`);
    for (const item of report.skipped) console.log(`Skipped: ${item.filePath || item.id} (${item.reason})`);
    for (const item of report.failed) console.error(`Failed: ${item.filePath} (${item.error})`);
    if (report.failed.length > 0) process.exitCode = 1;
  };

  private promptSelection = async (items: DiscoveredEndpoint[]): Promise<DiscoveredEndpoint[] | null> => {
    const checked = items.map(() => true);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (true) {
        console.log('');
        items.forEach((item, idx) => {
          const mark = checked[idx] ? '[x]' : '[ ]';
          const target = `${this.settings.url}/${item.suggestedPrefix}`;
          console.log(`${mark} ${idx + 1}. ${item.client} (${item.sourceLabel})  ${item.currentUrl} -> ${target}`);
        });
        const answer = (await rl.question('\nEnter numbers to toggle (e.g. 2), Enter to apply selected, q to cancel: ')).trim();
        if (answer === '') return items.filter((_, idx) => checked[idx]);
        if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit') return null;
        for (const token of answer.split(/[\s,]+/).filter(Boolean)) {
          const num = Number(token);
          if (Number.isInteger(num) && num >= 1 && num <= items.length) checked[num - 1] = !checked[num - 1];
        }
      }
    } finally { rl.close(); }
  };

  private printDryRun = (items: DiscoveredEndpoint[]): void => {
    console.log('Dry run (no files or routes were changed):\n');
    items.forEach((item, idx) => {
      const target = `${this.settings.url}/${item.suggestedPrefix}`;
      const mode = item.editable ? 'auto-edit' : 'manual';
      console.log(`${idx + 1}. [${mode}] ${item.client} (${item.sourceLabel})  ${item.currentUrl} -> ${target}`);
    });
  };

  private printSummary = (results: AppliedEndpointResult[], recoveryDocPath: string): void => {
    console.log('');
    for (const r of results) {
      if (r.status === 'applied') console.log(`Applied: ${r.endpoint.client} (${r.endpoint.sourceLabel}) -> ${r.corpGateUrl}`);
      else console.log(`Manual:  ${r.endpoint.client} (${r.endpoint.sourceLabel}) -> ${r.manualInstruction}${r.error ? ' (' + r.error + ')' : ''}`);
    }
    console.log('\nRecovery guide: ' + recoveryDocPath);
    console.log('Rollback command: npx -y corp-gate restore');
  };
}
