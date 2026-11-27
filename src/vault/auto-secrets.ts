import { SecretEntry } from '../types/index.js';
import { AliasConflict } from './alias-registry.js';
import { AutoSecretRow, VaultDatabase } from './sqlite-db.js';
import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';

export class AutoSecretStore {
  public static readonly TTL_MS = 10 * 24 * 60 * 60 * 1000;

  public static expiresAt = (now = Date.now()): string => new Date(now + AutoSecretStore.TTL_MS).toISOString();

  public static isExpired = (row: Pick<AutoSecretRow, 'last_seen_at' | 'expires_at'>, now = Date.now()): boolean => {
    if (row.expires_at) {
      const exp = Date.parse(row.expires_at);
      if (!Number.isNaN(exp)) return exp <= now;
    }
    if (row.last_seen_at) {
      const seen = Date.parse(row.last_seen_at);
      if (!Number.isNaN(seen)) return seen + AutoSecretStore.TTL_MS <= now;
    }
    return false;
  };

  public static toRow = (entry: SecretEntry, now = Date.now()): AutoSecretRow => ({
    key: entry.key, real_value: entry.realValue, alias: entry.alias, hit_count: entry.hitCount || 1,
    first_seen_at: entry.createdAt, last_seen_at: entry.updatedAt, expires_at: AutoSecretStore.expiresAt(now),
    is_secret: Number(Boolean(entry.isSecret)),
  });

  public static toEntry = (row: AutoSecretRow): SecretEntry => ({
    key: row.key, realValue: row.real_value, alias: row.alias, maskInAi: true, isSecret: Boolean(row.is_secret),
    variants: SecretRepresentations.variants(row.real_value), createdAt: row.first_seen_at,
    updatedAt: row.last_seen_at, storage: 'legacy', hitCount: row.hit_count,
  });

  public static pruneExpired = (db: VaultDatabase, autoSecrets: Map<string, SecretEntry>, forms: Map<string, readonly SecretRepresentation[]>, now = Date.now()): number => {
    const expired = db.getAutoSecrets().filter(row => AutoSecretStore.isExpired(row, now));
    if (!expired.length) return 0;
    db.aliases.transaction(() => {
      for (const row of expired) { db.deleteAutoSecret(row.key); db.aliases.forget(row.alias); }
    });
    for (const row of expired) { autoSecrets.delete(row.key); forms.delete(row.alias); }
    return expired.length;
  };

  public static create = (db: VaultDatabase, autoSecrets: Map<string, SecretEntry>, forms: Map<string, readonly SecretRepresentation[]>, entry: SecretEntry, onProtect?: (forms: readonly SecretRepresentation[]) => void): SecretEntry => {
    AutoSecretStore.pruneExpired(db, autoSecrets, forms);
    const now = Date.now();
    const full: SecretEntry = { ...entry, isSecret: entry.isSecret ?? db.protectedStorage.isAvailable(), storage: 'legacy', hitCount: 1 };
    const allocated = db.aliases.allocate(full, true, () => db.upsertAutoSecret(AutoSecretStore.toRow(full, now)));
    forms.set(full.alias, allocated);
    full.representations = allocated;
    autoSecrets.set(full.key, full);
    if (full.isSecret) onProtect?.(allocated);
    return full;
  };

  public static touch = (db: VaultDatabase, entry: SecretEntry, onProtect?: (forms: readonly SecretRepresentation[]) => void): SecretEntry => {
    const now = Date.now();
    entry.hitCount = (entry.hitCount || 1) + 1;
    entry.updatedAt = new Date(now).toISOString();
    if (!entry.isSecret && db.protectedStorage.isAvailable()) {
      entry.isSecret = true;
      if (entry.representations) onProtect?.(entry.representations);
    }
    db.upsertAutoSecret(AutoSecretStore.toRow(entry, now));
    return entry;
  };

  public static register = (db: VaultDatabase, autoSecrets: Map<string, SecretEntry>, forms: Map<string, readonly SecretRepresentation[]>, findByValue: (value: string) => SecretEntry | undefined, build: (key: string) => SecretEntry, prefix: string, onProtect?: (forms: readonly SecretRepresentation[]) => void): SecretEntry => {
    AutoSecretStore.pruneExpired(db, autoSecrets, forms);
    const existing = findByValue(build(prefix).realValue);
    if (existing) return existing.storage === 'manual' ? existing : AutoSecretStore.touch(db, existing, onProtect);
    for (let attempt = 0; attempt < 16; attempt++) {
      try { return AutoSecretStore.create(db, autoSecrets, forms, build(prefix + '_' + db.aliases.randomSuffix()), onProtect); }
      catch (error) { if (!(error instanceof AliasConflict)) throw error; }
    }
    throw Object.assign(new Error('Failed to allocate a unique label. Request was not sent.'), { statusCode: 503, code: 'ALIAS_ALLOCATION_EXHAUSTED' });
  };
}
