import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { CorpGateProxyServer } from '../../src/proxy/server.js';
import { RuntimeArguments } from '../../src/runtime/arguments.js';
import { RuntimeSettings } from '../../src/runtime/settings.js';
import { InitEndpointApplier } from '../../src/setup/init-applier.js';
import { InitCommand } from '../../src/setup/init-command.js';
import { ClientEndpointDiscovery } from '../../src/setup/init-discovery.js';
import { InitRecoveryStore } from '../../src/setup/init-recovery.js';
import { VaultDatabase } from '../../src/vault/sqlite-db.js';
import { VaultStore } from '../../src/vault/store.js';

class InitTests {
  private secretMarker = 'sk-ant-do-not-leak-9876543210';

  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpgate-init-'));
    const homeDir = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    const dataDir = path.join(root, 'data');
    mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    mkdirSync(path.join(homeDir, '.config', 'opencode'), { recursive: true });
    mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    mkdirSync(path.join(cwd, '.claude'), { recursive: true });

    const claudeHomePath = path.join(homeDir, '.claude', 'settings.json');
    const claudeLocalPath = path.join(cwd, '.claude', 'settings.local.json');
    const openCodePath = path.join(homeDir, '.config', 'opencode', 'opencode.json');
    const codexPath = path.join(homeDir, '.codex', 'config.toml');

    const claudeHomeOrig = JSON.stringify({ model: 'claude-sonnet', env: { ANTHROPIC_BASE_URL: 'https://litellm.corp.internal/anthropic', ANTHROPIC_AUTH_TOKEN: this.secretMarker } }, null, 2) + '\n';
    const claudeLocalOrig = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8767/claude-corp' } }, null, 2) + '\n';
    const openCodeOrig = JSON.stringify({
      provider: {
        litellm: { options: { baseURL: 'https://litellm.corp.internal/v1', apiKey: this.secretMarker } },
        already: { options: { baseUrl: 'http://localhost:8767/opencode-already' } },
      },
    }, null, 2) + '\n';
    const codexOrig = [
      '# Codex user config comment',
      'model = "gpt-5.4"',
      'openai_base_url = "https://codex-gw.corp.internal/v1" # keep inline comment',
      '',
      '[model_providers.corp]',
      'name = "Corp Gateway"',
      `env_key = "${this.secretMarker}"`,
      'base_url = "https://provider.corp.internal/openai"',
      '',
    ].join('\n');

    writeFileSync(claudeHomePath, claudeHomeOrig);
    writeFileSync(claudeLocalPath, claudeLocalOrig);
    writeFileSync(openCodePath, openCodeOrig);
    writeFileSync(codexPath, codexOrig);

    const env: NodeJS.ProcessEnv = {
      OPENAI_BASE_URL: 'https://env-gw.corp.internal/v1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8767/anthropic',
      OPENAI_API_KEY: this.secretMarker,
    };

    const db = new VaultDatabase(':memory:');
    const server = new CorpGateProxyServer(new VaultStore(db), { port: 0, host: '127.0.0.1' });
    try {
      const listenUrl = await server.listen();
      const port = Number(new URL(listenUrl).port);
      const settings = new RuntimeSettings({ dataDir, databasePath: ':memory:', port });
      const discovery = new ClientEndpointDiscovery({ homeDir, cwd, env, corpGatePort: 8767 });
      const discovered = discovery.discover();

      assert.equal(discovered.length, 5);
      assert.equal(JSON.stringify(discovered).includes(this.secretMarker), false);
      assert.equal(discovered.some(d => d.currentUrl.includes('127.0.0.1:8767') || d.currentUrl.includes('localhost:8767')), false);
      assert.equal(new Set(discovered.map(d => d.suggestedPrefix)).size, discovered.length);
      assert.ok(discovered.find(d => d.filePath === claudeHomePath && d.suggestedPrefix === 'claude-corp'));
      assert.ok(discovered.find(d => d.filePath === openCodePath && d.suggestedPrefix === 'opencode-litellm'));
      assert.ok(discovered.find(d => d.filePath === codexPath && d.fieldPath[0] === 'openai_base_url' && d.suggestedPrefix === 'codex-corp'));
      assert.ok(discovered.find(d => d.filePath === codexPath && d.fieldPath[0] === 'model_providers' && d.suggestedPrefix === 'codex-corp-2'));
      assert.ok(discovered.find(d => d.sourceKind === 'env' && d.envKey === 'OPENAI_BASE_URL' && d.editable === false));

      const drySettings = new RuntimeSettings({ dataDir, databasePath: ':memory:', port: 8767 });
      const args = new RuntimeArguments(['init', '--yes', '--dry-run', '--json', '--cwd', cwd, '--port', '8767', '--data-dir', dataDir, '--db', ':memory:']);
      assert.equal(args.command, 'init');
      assert.equal(args.values.yes, true);
      assert.equal(args.values['dry-run'], true);
      assert.equal(args.values.json, true);
      assert.equal(args.values.cwd, cwd);
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg?: unknown) => { logs.push(String(msg ?? '')); };
      try { await new InitCommand(drySettings, { homeDir, cwd, env }).run(args); }
      finally { console.log = origLog; }
      const dryOutput = JSON.parse(logs[0]);
      assert.equal(dryOutput.dryRun, true);
      assert.equal(dryOutput.discovered.length, 5);
      assert.equal(existsSync(path.join(dataDir, 'RECOVERY.md')), false);

      const adminToken = server.getAdminToken();
      await server.getApp().inject({
        method: 'POST',
        url: '/api/routes',
        headers: { authorization: 'Bearer ' + adminToken, 'content-type': 'application/json' },
        payload: { name: 'Existing Claude', prefix: 'claude-corp', upstreamUrl: 'https://other.corp.internal', proxyMode: 'direct' },
      });

      const recovery = new InitRecoveryStore(dataDir);
      const applier = new InitEndpointApplier({ settings, recovery, adminToken, platform: 'linux' });
      const results = await applier.apply(discovered);
      assert.equal(results.length, 5);

      const claudeResult = results.find(r => r.endpoint.filePath === claudeHomePath)!;
      assert.equal(claudeResult.status, 'applied');
      assert.equal(claudeResult.prefix, 'claude-corp-2');
      assert.equal(claudeResult.corpGateUrl, `http://127.0.0.1:${port}/claude-corp-2`);

      const claudeUpdated = JSON.parse(readFileSync(claudeHomePath, 'utf8'));
      assert.equal(claudeUpdated.env.ANTHROPIC_BASE_URL, claudeResult.corpGateUrl);
      assert.equal(claudeUpdated.env.ANTHROPIC_AUTH_TOKEN, this.secretMarker);
      assert.equal(claudeUpdated.model, 'claude-sonnet');
      assert.equal(readFileSync(claudeLocalPath, 'utf8'), claudeLocalOrig);

      const openCodeResult = results.find(r => r.endpoint.filePath === openCodePath)!;
      assert.equal(openCodeResult.status, 'applied');
      const openCodeUpdated = JSON.parse(readFileSync(openCodePath, 'utf8'));
      assert.equal(openCodeUpdated.provider.litellm.options.baseURL, openCodeResult.corpGateUrl);
      assert.equal(openCodeUpdated.provider.litellm.options.apiKey, this.secretMarker);
      assert.equal(openCodeUpdated.provider.already.options.baseUrl, 'http://localhost:8767/opencode-already');

      const codexText = readFileSync(codexPath, 'utf8');
      assert.ok(codexText.includes('# Codex user config comment'));
      assert.ok(codexText.includes('# keep inline comment'));
      const codexParsed = parseToml(codexText) as Record<string, any>;
      assert.equal(codexParsed.model, 'gpt-5.4');
      assert.equal(codexParsed.openai_base_url, `http://127.0.0.1:${port}/codex-corp`);
      assert.equal(codexParsed.model_providers.corp.base_url, `http://127.0.0.1:${port}/codex-corp-2`);
      assert.equal(codexParsed.model_providers.corp.env_key, this.secretMarker);

      const envResult = results.find(r => r.endpoint.sourceKind === 'env')!;
      assert.equal(envResult.status, 'manual');
      assert.equal(envResult.manualInstruction, `export OPENAI_BASE_URL="http://127.0.0.1:${port}/env-openai"`);

      const winApplier = new InitEndpointApplier({ settings, recovery, adminToken, platform: 'win32' });
      const winEnvResult = await winApplier.apply([discovered.find(d => d.sourceKind === 'env')!]);
      assert.equal(winEnvResult[0].status, 'manual');
      assert.equal(winEnvResult[0].manualInstruction, `$env:OPENAI_BASE_URL="http://127.0.0.1:${port}/env-openai"`);

      const routesRes = await server.getApp().inject({ url: '/api/routes', headers: { authorization: 'Bearer ' + adminToken } });
      const routes = routesRes.json() as Array<{ prefix: string; upstreamUrl: string; proxyMode: string }>;
      for (const r of results) {
        const route = routes.find(item => item.prefix === r.prefix);
        assert.ok(route, 'Missing route for ' + r.prefix);
        assert.equal(route.proxyMode, 'direct');
        assert.equal(route.upstreamUrl, r.endpoint.currentUrl.replace(/\/+$/, ''));
      }

      const recoveryText = readFileSync(recovery.recoveryDocPath, 'utf8');
      assert.equal(recoveryText.includes(this.secretMarker), false);
      assert.ok(recoveryText.includes('npx -y corp-gate restore'));
      assert.ok(recoveryText.includes('https://litellm.corp.internal/anthropic'));
      assert.ok(recoveryText.includes('https://env-gw.corp.internal/v1'));

      const readOnlyPath = path.join(root, 'readonly-settings.json');
      writeFileSync(readOnlyPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://ro.corp.internal/anthropic' } }));
      chmodSync(readOnlyPath, 0o444);
      const roOutcome = await applier.apply([{
        id: 'ro-1', client: 'Claude ReadOnly', sourceKind: 'json', editable: true, apiFormat: 'anthropic',
        sourceLabel: readOnlyPath, filePath: readOnlyPath, fieldPath: ['env', 'ANTHROPIC_BASE_URL'],
        currentUrl: 'https://ro.corp.internal/anthropic', suggestedPrefix: 'claude-ro',
      }]);
      chmodSync(readOnlyPath, 0o600);
      assert.equal(roOutcome[0].status, 'manual');

      const restoreReport = recovery.restore();
      assert.equal(restoreReport.failed.length, 0);
      assert.equal(restoreReport.restored.length, 3);
      assert.equal(readFileSync(claudeHomePath, 'utf8'), claudeHomeOrig);
      assert.equal(readFileSync(openCodePath, 'utf8'), openCodeOrig);
      assert.equal(readFileSync(codexPath, 'utf8'), codexOrig);

      console.log('PASS init: discovery, secret isolation, route registration, JSON/TOML updates, env manual fallback, RECOVERY.md, and byte-for-byte restore');
    } finally {
      await server.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

await new InitTests().run();
