import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class PackVerifier {
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  forbidden = [
    /(?:^|\/)test-[^/]+$/,
    /\.map$/,
    /\.d\.ts$/,
    /^(?:web|tests|scripts|internal)\//,
    /^AGENTS\.md$/,
    /(?:^|\/)[^/]+-style\.md$/,
  ];
  required = [
    'dist/index.js',
    'public/index.html',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'docs/installation.md',
    'docs/recovery.md',
    'docs/architecture.md',
    'skills/corp-gate/SKILL.md',
  ];

  parseOutput = raw => {
    const start = raw.lastIndexOf('\n[');
    const jsonText = start >= 0 ? raw.slice(start + 1) : raw.slice(raw.indexOf('['));
    return JSON.parse(jsonText);
  };

  run = () => {
    const result = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'], { cwd: this.root, encoding: 'utf8', windowsHide: true })
      : spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: this.root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'npm pack failed').trim());
    const pack = this.parseOutput(result.stdout || '');
    const files = (pack[0]?.files || []).map(entry => String(entry.path).replaceAll('\\', '/'));
    const blocked = files.filter(file => this.forbidden.some(rule => rule.test(file)));
    const present = new Set(files);
    const missing = this.required.filter(file => !present.has(file));
    if (blocked.length || missing.length) {
      const details = [
        ...(blocked.length ? ['Forbidden files in tarball: ' + blocked.join(', ')] : []),
        ...(missing.length ? ['Missing required files in tarball: ' + missing.join(', ')] : []),
      ];
      throw new Error(details.join('\n'));
    }
    console.log(`PASS verify:pack (${files.length} tarball files verified)`);
  };
}

try { new PackVerifier().run(); }
catch (error) { console.error('FAIL verify:pack:\n' + error.message); process.exitCode = 1; }
