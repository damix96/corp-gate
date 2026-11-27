import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface InitBackupEntry {
  id: string;
  client: string;
  filePath: string;
  backupPath: string;
  originalUrl: string;
  corpGateUrl: string;
  prefix: string;
  timestamp: string;
}

export interface InitManualEntry {
  id: string;
  client: string;
  sourceLabel: string;
  envKey?: string;
  originalUrl: string;
  corpGateUrl: string;
  prefix: string;
  instruction: string;
  timestamp: string;
}

export interface InitManifest {
  entries: InitBackupEntry[];
  manual: InitManualEntry[];
}

export interface RestoreEntryReport {
  id: string;
  client: string;
  filePath: string;
  backupPath: string;
  reason?: string;
  error?: string;
}

export interface RestoreResult {
  restored: RestoreEntryReport[];
  skipped: RestoreEntryReport[];
  failed: RestoreEntryReport[];
}

export class InitRecoveryStore {
  public readonly backupsDir: string;
  public readonly manifestPath: string;
  public readonly recoveryDocPath: string;
  private counter = 0;

  constructor(private dataDir: string) {
    this.backupsDir = path.join(dataDir, 'backups');
    this.manifestPath = path.join(this.backupsDir, 'init-manifest.json');
    this.recoveryDocPath = path.join(dataDir, 'RECOVERY.md');
  }

  public ensureDirectories = (): void => {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.backupsDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      chmodSync(this.dataDir, 0o700);
      chmodSync(this.backupsDir, 0o700);
    }
  };

  public backupFile = (filePath: string): string => {
    this.ensureDirectories();
    this.counter += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
    const backupPath = path.join(this.backupsDir, `${stamp}-${this.counter}-${safeName}`);
    copyFileSync(filePath, backupPath);
    if (process.platform !== 'win32') chmodSync(backupPath, 0o600);
    return backupPath;
  };

  public readManifest = (): InitManifest => {
    if (!existsSync(this.manifestPath)) return { entries: [], manual: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, 'utf8'));
      if (Array.isArray(parsed)) return { entries: parsed, manual: [] };
      return { entries: Array.isArray(parsed?.entries) ? parsed.entries : [], manual: Array.isArray(parsed?.manual) ? parsed.manual : [] };
    } catch { return { entries: [], manual: [] }; }
  };

  public recordBackup = (entry: InitBackupEntry): void => {
    this.ensureDirectories();
    const manifest = this.readManifest();
    manifest.entries.push(entry);
    this.writeAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 0o600);
    this.writeRecoveryDoc(manifest);
  };

  public recordManual = (entry: InitManualEntry): void => {
    this.ensureDirectories();
    const manifest = this.readManifest();
    const idx = manifest.manual.findIndex(item => item.sourceLabel === entry.sourceLabel && item.prefix === entry.prefix);
    if (idx >= 0) manifest.manual[idx] = entry;
    else manifest.manual.push(entry);
    this.writeAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 0o600);
    this.writeRecoveryDoc(manifest);
  };

  public writeRecoveryDoc = (manifest = this.readManifest()): void => {
    this.ensureDirectories();
    const lines = [
      '# CorpGate Init Recovery Guide',
      '',
      'Generated: ' + new Date().toISOString(),
      'Data directory: ' + this.dataDir,
      '',
      '## Automatic Restore',
      '',
      'Run the following command to restore all backed-up configuration files byte-for-byte:',
      '',
      '```sh',
      'npx -y corp-gate restore',
      '```',
      '',
      '## Switched Configuration Files',
      '',
    ];
    if (manifest.entries.length === 0) {
      lines.push('No file-based configurations have been switched.');
    } else {
      lines.push('| Client | Source File | Original BASE_URL | CorpGate URL | Prefix | Backup File |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const e of manifest.entries) {
        lines.push(`| ${this.esc(e.client)} | ${this.esc(e.filePath)} | ${this.esc(e.originalUrl)} | ${this.esc(e.corpGateUrl)} | ${this.esc(e.prefix)} | ${this.esc(e.backupPath)} |`);
      }
    }
    if (manifest.manual.length > 0) {
      lines.push('', '## Manual and Environment Overrides', '', '| Client | Source | Original BASE_URL | CorpGate URL | Prefix | Restore Note |', '| --- | --- | --- | --- | --- | --- |');
      for (const m of manifest.manual) {
        const restoreNote = m.envKey ? `Restore ${m.envKey} to ${m.originalUrl}` : `Restore ${m.sourceLabel} to ${m.originalUrl}`;
        lines.push(`| ${this.esc(m.client)} | ${this.esc(m.sourceLabel)} | ${this.esc(m.originalUrl)} | ${this.esc(m.corpGateUrl)} | ${this.esc(m.prefix)} | ${this.esc(restoreNote)} |`);
      }
    }
    lines.push(
      '',
      '## Manual Rollback',
      '',
      '1. Copy each Backup File back over its Source File path listed above.',
      '2. For environment overrides, restore or unset the recorded environment variable in your shell profile or launcher.',
      '3. Restart the AI client to pick up the restored endpoint.',
      ''
    );
    this.writeAtomic(this.recoveryDocPath, lines.join('\n'), 0o600);
  };

  public restore = (): RestoreResult => {
    const manifest = this.readManifest();
    const restored: RestoreEntryReport[] = [];
    const skipped: RestoreEntryReport[] = [];
    const failed: RestoreEntryReport[] = [];
    const chosenByFile = new Map<string, InitBackupEntry>();
    for (const entry of manifest.entries) {
      if (!entry.filePath) {
        skipped.push({ id: entry.id, client: entry.client, filePath: entry.filePath, backupPath: entry.backupPath, reason: 'Missing target file path' });
        continue;
      }
      const key = process.platform === 'win32' ? path.resolve(entry.filePath).toLowerCase() : path.resolve(entry.filePath);
      const prev = chosenByFile.get(key);
      if (!prev || (!existsSync(prev.backupPath) && existsSync(entry.backupPath))) chosenByFile.set(key, entry);
    }
    let idx = 0;
    for (const entry of chosenByFile.values()) {
      idx += 1;
      if (!entry.backupPath || !existsSync(entry.backupPath)) {
        skipped.push({ id: entry.id, client: entry.client, filePath: entry.filePath, backupPath: entry.backupPath, reason: 'Backup file does not exist' });
        continue;
      }
      const tmp = `${entry.filePath}.corpgate-restore-${process.pid}-${Date.now()}-${idx}.tmp`;
      try {
        mkdirSync(path.dirname(entry.filePath), { recursive: true });
        copyFileSync(entry.backupPath, tmp);
        renameSync(tmp, entry.filePath);
        restored.push({ id: entry.id, client: entry.client, filePath: entry.filePath, backupPath: entry.backupPath });
      } catch (error) {
        failed.push({ id: entry.id, client: entry.client, filePath: entry.filePath, backupPath: entry.backupPath, error: (error as Error).message });
      } finally { rmSync(tmp, { force: true }); }
    }
    return { restored, skipped, failed };
  };

  private writeAtomic = (targetPath: string, content: string, mode = 0o600): void => {
    this.counter += 1;
    const tmp = `${targetPath}.corpgate-${process.pid}-${Date.now()}-${this.counter}.tmp`;
    writeFileSync(tmp, content, { encoding: 'utf8', mode });
    try {
      renameSync(tmp, targetPath);
      if (process.platform !== 'win32') chmodSync(targetPath, mode);
    } finally { rmSync(tmp, { force: true }); }
  };

  private esc = (value: string): string => String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}
