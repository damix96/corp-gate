import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';
import { RuntimeSettings } from '../../src/runtime/settings.js';
import { RuntimeArguments } from '../../src/runtime/arguments.js';
import { SetupCommand } from '../../src/setup/command.js';
import { ClientConfigInstaller } from '../../src/setup/config.js';
import { SetupInstructions } from '../../src/setup/instructions.js';
import { HostCommand } from '../../src/setup/host-command.js';

class SetupTests {
  public run = (): void => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpgate-setup-'));
    const settings = new RuntimeSettings({ dataDir: path.join(root, 'not-created'), port: 43123 });
    const installer = new ClientConfigInstaller(settings);
    try {
      const target = path.join(root, 'config.toml');
      const original = '# keep comments\nmodel = "synthetic"\n[mcp_servers.corpgate]\ncommand = "custom"\nenv = { KEEP = "synthetic" }\n';
      writeFileSync(target, original);
      for (const client of ['claude', 'cursor', 'codex'] as const) {
        const result = installer.install(client);
        assert.equal(result.changed, false);
        const value = client === 'codex' ? parse(result.content) : JSON.parse(result.content);
        const entry = value[client === 'codex' ? 'mcp_servers' : 'mcpServers'].corpgate;
        assert.ok(['npx', 'cmd'].includes(entry.command));
        assert.ok(entry.command === 'cmd' ? entry.args[3].startsWith('npx -y corp-gate mcp-bridge') : entry.args[0] === '-y' && entry.args[1] === 'corp-gate');
        assert.ok(JSON.stringify(entry).includes('corp-gate'));
        assert.equal(JSON.stringify(entry).includes(process.execPath.replaceAll('\\', '\\\\')), false);
        assert.throws(() => installer.install(client, target), /only prints/);
      }
      for (const args of [['setup', '--config', target], ['setup', '--autostart', '--apply'], ['setup', '--dry-run']]) assert.throws(() => new SetupCommand().run(new RuntimeArguments(args)), /output-only/);
      assert.equal(readFileSync(target, 'utf8'), original);
      assert.deepEqual(readdirSync(root), ['config.toml']);
      assert.equal(existsSync(settings.dataDir), false);
      const text = new SetupInstructions(settings, installer).render();
      for (const term of ['LiteLLM', 'FIRST', 'precedence', 'corporate', 'recovery', 'npx corp-gate probe', 'MCP separately']) assert.ok(text.includes(term));
      assert.ok(text.indexOf('FIRST put the old') < text.indexOf('Only after the route test succeeds'));
      const encoded = HostCommand.settings(settings);
      assert.equal(HostCommand.decode(encoded).databasePath, settings.databasePath);
      assert.throws(() => HostCommand.decode('%%%'), /Invalid/);
      assert.throws(() => HostCommand.decode(Buffer.from(JSON.stringify({ dataDir: 'x', databasePath: 'x', port: 8767, token: 'bad' })).toString('base64url')), /Invalid/);
      assert.throws(() => new RuntimeArguments(['status', '--host-settings', encoded]), /only valid/);
      console.log('PASS setup: no file/database/autostart mutation, legacy writes rejected, npx MCP fragments, recovery-before-cutover and strict host settings');
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

new SetupTests().run();
