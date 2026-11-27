import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class PublicExporter {
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  whitelist = [
    'src', 'web', 'tests', 'scripts', 'docs', 'skills/corp-gate', '.github/workflows',
    'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsconfig.build.json', 'vite.config.ts', '.gitignore',
  ];

  resolveOutput = () => {
    const args = process.argv.slice(2);
    const index = args.indexOf('--out');
    const raw = index >= 0 ? args[index + 1] : '.cache/corpgate-public-export';
    if (!raw) throw new Error('Missing directory path after --out');
    const target = path.resolve(this.root, raw);
    if (target === this.root || this.root.startsWith(target + path.sep)) throw new Error('Unsafe --out directory: ' + target);
    return target;
  };

  run = () => {
    const target = this.resolveOutput();
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const copied = [];
    for (const item of this.whitelist) {
      const source = path.join(this.root, item);
      if (!existsSync(source)) continue;
      const dest = path.join(target, item);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(source, dest, { recursive: true });
      copied.push(item);
    }
    console.log(`PASS export:public (${copied.length} entries copied to ${target})`);
  };
}

try { new PublicExporter().run(); }
catch (error) { console.error('FAIL export:public: ' + error.message); process.exitCode = 1; }
