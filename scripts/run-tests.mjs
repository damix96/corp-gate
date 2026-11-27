import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

class RegressionRunner {
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  defaults = [
    'test-server', 'test-hooks', 'test-telemetry', 'test-mcp',
    'test-sqlite-patterns', 'test-gateway-regressions', 'test-protocols',
    'test-protocol-transport', 'test-protocol-streams', 'test-native-transport',
    'test-composite-replacements', 'test-admin-regressions', 'test-response-change-evidence', 'test-env-file-masking', 'test-vault-hardening',
  ];

  compileTests = () => {
    const cacheDir = path.join(this.root, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    const configPath = path.join(cacheDir, 'tsconfig.tests.json');
    writeFileSync(configPath, JSON.stringify({
      extends: '../tsconfig.json',
      compilerOptions: { outDir: './test-dist', rootDir: '..', declaration: false, sourceMap: false, noEmit: false },
      include: ['../src/**/*', '../tests/**/*'],
    }, null, 2) + '\n');
    const tsc = path.join(this.root, 'node_modules/typescript/bin/tsc');
    const build = spawnSync(process.execPath, [tsc, '-p', configPath], { cwd: this.root, encoding: 'utf8', windowsHide: true });
    if (build.status !== 0) throw new Error((build.stdout || '') + (build.stderr || 'Test compilation failed'));
  };

  run = () => {
    const args = process.argv.slice(2);
    this.compileTests();
    if (args[0] === '--build-only') return;
    const names = args.length ? args : this.defaults;
    const tests = names.map(name => {
      if (!/^test-[a-z0-9-]+$/.test(name)) throw new Error('Invalid test name: ' + name);
      const entry = path.join(this.root, '.cache/test-dist/tests', name + '.js');
      if (!existsSync(entry)) throw new Error('Missing compiled test: ' + name);
      return { name, entry };
    });
    const cache = path.join(this.root, '.cache/test-runs');
    mkdirSync(cache, { recursive: true });
    const directory = mkdtempSync(path.join(cache, 'run-'));
    const work = path.join(directory, 'work');
    mkdirSync(path.join(work, '.cache'), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CORPGATE_/i.test(key)));
    env.CORPGATE_DB_PATH = ':memory:';
    const results = [];
    for (const { name, entry } of tests) {
      const cwd = path.join(work, name);
      mkdirSync(cwd);
      const started = Date.now();
      const result = spawnSync(process.execPath, [entry], { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      writeFileSync(path.join(cwd, 'stdout.log'), result.stdout || '');
      writeFileSync(path.join(cwd, 'stderr.log'), result.stderr || '');
      results.push({ name, exitCode: result.status, signal: result.signal, error: result.error?.message, durationMs: Date.now() - started, cwd });
      writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ node: process.version, results }, null, 2) + '\n');
      console.log((result.status === 0 ? 'PASS ' : 'FAIL ') + name);
      if (result.status !== 0) {
        console.error((result.stderr || result.stdout || result.error?.message || 'Test failed').slice(-6000));
        process.exitCode = 1;
        break;
      }
    }
    console.log('Regression report: ' + path.join(directory, 'results.json'));
  };
}

try { new RegressionRunner().run(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
