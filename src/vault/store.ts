import { SecretEntry, SecretPublicEntry } from '../types/index.js';
import { VaultDatabase, SecretRow } from './sqlite-db.js';
import { TextReplacer } from './text-replacer.js';
import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';
import { AliasConflict } from './alias-registry.js';
import { LabelTemplate } from './label-template.js';
import { randomUUID } from 'node:crypto';
import { CatalogInput, VariableCatalog } from './variable-catalog.js';
import { SecretProjection } from './secret-projection.js';
import { ProtectedTextProjection, SecretRedactor } from './secret-redactor.js';
import { protectedBatch, protectedTargets, ProtectedManualBatch, ProtectedReceipt, ProtectedTarget, ProtectedManualTarget, ProtectedValuesInput, ProtectedWrites } from './protected-writes.js';
import { AutoSecretStore } from './auto-secrets.js';

interface ManualWrite { key: string; realValue: string; description?: string; isSecret?: boolean }

export class VaultStore {
  private db: VaultDatabase;
  private manualSecrets = new Map<string, SecretEntry>();
  private autoSecrets = new Map<string, SecretEntry>();
  private archived: SecretEntry[] = [];
  private forms = new Map<string, readonly SecretRepresentation[]>();
  private redactor = new SecretRedactor();

  constructor(db?: VaultDatabase) {
    this.db = db ?? new VaultDatabase();
    this.loadFromDb();
  }

  public getDatabase = (): VaultDatabase => this.db;
  public static computeVariants = SecretRepresentations.variants;

  public toggleSecretMask = (key: string): boolean => {
    const s = this.manualSecrets.get(key);
    if (!s) return false;
    const stored = this.db.getSecrets().find(row => row.key === key);
    if (!stored) return false;
    const maskInAi = !Boolean(stored.mask_in_ai), updatedAt = new Date().toISOString();
    this.db.aliases.transaction(() => {
      if (!this.db.updateSecretMask(key, maskInAi, updatedAt, stored.write_revision || '')) throw Object.assign(new Error('A variable changed. Refresh before toggling masking.'), { statusCode: 409, code: 'SECRET_WRITE_CONFLICT' });
    });
    Object.assign(s, { maskInAi, updatedAt });
    return true;
  };

  private fromRow = (stored: SecretRow): SecretEntry => {
    const row = this.db.protectedStorage.decode(stored);
    return { key: row.key, realValue: row.real_value, alias: row.alias, maskInAi: Boolean(row.mask_in_ai), isSecret: Boolean(row.is_secret), description: row.description, variants: VaultStore.computeVariants(row.real_value), createdAt: row.created_at, updatedAt: row.updated_at, storage: 'manual' };
  };

  private loadFromDb = (): void => {
    for (const row of this.db.getSecrets()) this.manualSecrets.set(row.key, this.fromRow(row));
    this.pruneExpiredAutoSecrets();
    for (const row of this.db.getAutoSecrets()) {
      if (this.manualSecrets.has(row.key)) throw new AliasConflict('Legacy manual/auto key conflict. Data preserved; resolve the conflict before starting.');
      this.autoSecrets.set(row.key, AutoSecretStore.toEntry(this.db.protectedStorage.decodeAuto(row)));
    }
    this.archived = this.db.getVersions().map(this.fromRow);
    const entries = [...this.getManualSecrets(), ...this.getAutoSecrets(), ...this.archived];
    const identities = new Map<string, string>();
    for (const entry of [...this.getManualSecrets(), ...this.getAutoSecrets()]) {
      if (identities.has(entry.alias) && identities.get(entry.alias) !== entry.key) throw new AliasConflict('Stored records contain duplicate labels. Data preserved; resolve the conflict before starting.');
      identities.set(entry.alias, entry.key);
    }
    const legacy = new SecretRepresentations(entries);
    this.db.aliases.transaction(() => {
      const uncertain = new Set(this.archived.filter(entry => identities.has(entry.alias) && identities.get(entry.alias) !== entry.key).map(entry => entry.alias));
      this.db.archivedRepresentations.capture(this.db.getVersions().map(this.db.protectedStorage.decode), uncertain);
      for (const entry of entries) {
        if (!this.db.aliases.owner(entry.alias)) this.db.aliases.reserve(legacy.get(entry), randomUUID(), true, true);
      }
      for (const entry of this.manualSecrets.values()) {
        const previousAlias = entry.alias;
        const alias = this.entry(entry.key, entry.realValue).alias;
        const allowExisting = previousAlias === alias || this.archived.some(version => version.key === entry.key && version.alias === alias);
        entry.alias = alias;
        const forms = this.db.manualBindings.bind(entry, allowExisting);
        if (previousAlias !== alias) this.persist(entry);
        this.forms.set(entry.alias, forms);
        entry.representations = forms;
      }
      for (const entry of this.autoSecrets.values()) {
        const forms = this.db.aliases.load(entry)!;
        this.forms.set(entry.alias, forms);
        entry.representations = forms;
      }
    });
    for (const entry of this.manualSecrets.values()) entry.retainedVersions = this.archived.filter(version => version.key === entry.key).length;
    for (const entry of [...this.manualSecrets.values(), ...this.autoSecrets.values()]) if (entry.isSecret) this.redactor.remember(this.getSecretRepresentations(entry));
    for (const row of this.db.getVersions().filter(row => row.is_secret)) this.redactor.remember(this.historicalRedactions(row));
  };

  private entry = (key: string, realValue: string, description?: string): SecretEntry => {
    if (!/^[A-Z0-9_]+$/.test(key)) throw Object.assign(new Error('Name must contain only A-Z, 0-9, and _.'), { statusCode: 400 });
    const now = new Date().toISOString();
    return { key, realValue, alias: '$${<' + key + '>}', maskInAi: true, description, variants: VaultStore.computeVariants(realValue), createdAt: now, updatedAt: now };
  };

  private persist = (entry: SecretEntry): void => this.db.upsertSecret({ key: entry.key, real_value: entry.realValue, alias: entry.alias, mask_in_ai: Number(entry.maskInAi), is_secret: Number(Boolean(entry.isSecret)), description: entry.description || '', created_at: entry.createdAt, updated_at: entry.updatedAt });

  private writeManual = (writes: ManualWrite[], guard: () => void = () => {}): SecretEntry[] => {
    if (!writes.length || new Set(writes.map(write => write.key)).size !== writes.length) throw Object.assign(new Error('Invalid secret target set.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const entries = writes.map(({ key, realValue, description, isSecret }) => {
      if (this.autoSecrets.has(key)) throw new AliasConflict('Name belongs to an auto-secret. Pin it first.');
      const current = this.manualSecrets.get(key);
      if (current?.isSecret && isSecret === false) {
        const stored = this.db.getSecrets().find(row => row.key === key);
        if (!stored) throw Object.assign(new Error('A variable changed. Refresh before saving.'), { statusCode: 409, code: 'SECRET_WRITE_CONFLICT' });
        this.db.protectedStorage.decode(stored);
      }
      return { ...this.entry(key, realValue, description), storage: 'manual' as const, isSecret: isSecret ?? current?.isSecret ?? this.db.protectedStorage.isAvailable(), maskInAi: current?.maskInAi ?? true, createdAt: current?.createdAt || new Date().toISOString(), retainedVersions: this.archived.filter(version => version.key === key).length };
    });
    const protectedKeys = new Set(entries.filter(entry => entry.isSecret).map(entry => entry.key));
    const unprotectedKeys = new Set(writes.filter(write => write.isSecret === false).map(write => write.key));
    if (entries.some(entry => entry.isSecret && Buffer.byteLength(entry.realValue, 'utf8') > 65536)) throw Object.assign(new Error('Protected value exceeds the byte limit.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const history = this.db.getVersions().filter(row => protectedKeys.has(row.key));
    const retained = [...history.flatMap(this.historicalRedactions), ...[...protectedKeys].flatMap(key => this.manualSecrets.get(key)?.representations || [])];
    const purge = [...protectedKeys].some(key => this.manualSecrets.has(key) && !this.manualSecrets.get(key)?.isSecret) || history.some(row => !row.is_secret);
    const superseded = [...this.autoSecrets.values()].filter(auto => entries.some(entry => entry.realValue === auto.realValue));
    const forms = this.db.aliases.transaction(() => {
      guard();
      if (protectedKeys.size) this.db.protectedStorage.markPending(purge);
      for (const auto of superseded) { this.db.deleteAutoSecret(auto.key); this.db.aliases.forget(auto.alias); }
      const active = new Set(this.activeAliases());
      const allocatedForms = entries.map(entry => {
        const allocated = this.db.manualBindings.bind(entry, this.manualSecrets.has(entry.key), undefined, active);
        allocated.forEach(form => active.add(form.alias));
        this.persist(entry);
        if (entry.isSecret) this.db.protectedStorage.protectArchives(entry.key, this.db.archivedRepresentations.relocate);
        if (unprotectedKeys.has(entry.key)) this.db.protectedStorage.unprotectArchives(entry.key);
        return allocated;
      });
      if (protectedKeys.size) this.db.protectedStorage.sanitizeDiagnostics([...retained, ...allocatedForms.flatMap((forms, index) => entries[index].isSecret ? forms : [])]);
      return allocatedForms;
    });
    for (const auto of superseded) { this.autoSecrets.delete(auto.key); this.forms.delete(auto.alias); }
    entries.forEach((entry, index) => {
      this.forms.set(entry.alias, forms[index]);
      const stored: SecretEntry = { ...entry, representations: forms[index] };
      this.manualSecrets.set(entry.key, stored);
      if (entry.isSecret) this.redactor.remember(forms[index]);
    });
    this.archived = this.archived.map(entry => protectedKeys.has(entry.key) || unprotectedKeys.has(entry.key) ? { ...entry, isSecret: protectedKeys.has(entry.key) } : entry);
    this.redactor.remember(retained);
    if (this.db.protectedStorage.cleanupPending) this.db.protectedStorage.clean();
    return entries.map(entry => this.manualSecrets.get(entry.key)!);
  };

  public setManualSecret = (key: string, realValue: string, description?: string, isSecret?: boolean, expected?: string | null): SecretEntry => this.writeManual([{ key, realValue, description, isSecret }], () => {
    if (expected !== undefined && this.captureProtectedTargets([key])[0].revision !== expected) throw Object.assign(new Error('A variable changed. Refresh before saving.'), { statusCode: 409, code: 'SECRET_WRITE_CONFLICT' });
  })[0];

  public setManualProtection = (key: string, input: { isSecret: boolean; realValue?: string; description?: string; expectedRevision?: string }): SecretEntry | null => {
    const current = this.manualSecrets.get(key);
    if (!current) return null;
    const stored = this.db.getSecrets().find(row => row.key === key);
    if (!stored) return null;
    const decoded = this.db.protectedStorage.decode(stored);
    if (Boolean(current.isSecret) === input.isSecret && input.realValue === undefined && input.description === undefined && !this.db.getVersions().some(row => row.key === key && Boolean(row.is_secret) !== input.isSecret)) { this.db.protectedStorage.clean(); return current; }
    return this.setManualSecret(key, input.realValue ?? decoded.real_value, input.description ?? decoded.description, input.isSecret, input.expectedRevision ?? stored.write_revision ?? '');
  };
  public protectManualSecret = (key: string): SecretEntry | null => this.setManualProtection(key, { isSecret: true });
  public publicEntry = (entry: SecretEntry): SecretPublicEntry => ({ ...SecretProjection.entry(entry), description: this.redactor.redact(entry.description) });
  public redactProtected = <T>(value: T): T => this.redactor.redact(value);
  public projectProtectedText = (value: string): ProtectedTextProjection => this.redactor.project(value);
  public redactProtectedPreview = (value: string): string => this.redactor.redactPreview(value);
  public getSecretStorageNotice = () => this.db.protectedStorage.notice();

  public captureProtectedTargets = (names: string[]): ProtectedTarget[] => {
    if (!protectedTargets.safeParse(names).success) throw Object.assign(new Error('Invalid secret target set.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const revisions = new Map(this.db.getSecrets().map(row => [row.key, row.write_revision || '']));
    return names.map(key => ({ key, revision: revisions.get(key) ?? null }));
  };

  public captureSecretTargets = (names: string[]): ProtectedManualTarget[] => this.captureProtectedTargets(names).map(target => ({ name: target.key, expectedRevision: target.revision }));

  public commitProtectedSecrets = (input: ProtectedValuesInput): SecretPublicEntry[] => {
    const batch = ProtectedWrites.batch(input);
    this.commitProtectedManualBatch(batch);
    return batch.entries.map(entry => this.publicEntry(this.manualSecrets.get(entry.name)!));
  };

  public commitProtectedManualBatch = (input: ProtectedManualBatch): ProtectedReceipt => {
    const parsed = protectedBatch.safeParse(input);
    if (!parsed.success) throw Object.assign(new Error('Invalid secret input.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const guard = () => {
      const current = new Map(this.db.getSecrets().map(row => [row.key, row.write_revision || '']));
      if (parsed.data.entries.some(entry => (current.get(entry.name) ?? null) !== entry.expectedRevision)) throw Object.assign(new Error('A secret target changed. Open a new input request.'), { statusCode: 409, code: 'SECRET_WRITE_CONFLICT' });
    };
    const writes = parsed.data.entries.map(entry => ({ key: entry.name, realValue: entry.value, description: entry.description ?? this.manualSecrets.get(entry.name)?.description, isSecret: entry.isSecret ?? true }));
    const saved = this.writeManual(writes, guard);
    const notice = this.getSecretStorageNotice();
    return { requestId: parsed.data.requestId, variables: saved.map(entry => ({ name: entry.key, token: entry.alias })), ...(notice ? { notice } : {}) };
  };

  public renameManualSecret = (key: string, name: string): SecretEntry | null => {
    const current = this.manualSecrets.get(key);
    if (!current) return null;
    const renamed = { ...current, ...this.entry(name, current.realValue, current.description), maskInAi: current.maskInAi, createdAt: current.createdAt };
    if (name === key) return current;
    if (this.manualSecrets.has(name) || this.autoSecrets.has(name)) throw new AliasConflict('Name is already used by another variable.');
    const forms = this.db.aliases.transaction(() => {
      const allocated = this.db.manualBindings.bind(renamed, false, this.db.aliases.owner(current.alias), this.activeAliases());
      this.persist(renamed);
      this.db.deleteSecret(key);
      this.db.renameVersions(key, name);
      if (renamed.isSecret) this.db.protectedStorage.markPending();
      return allocated;
    });
    renamed.representations = forms;
    this.forms.delete(current.alias);
    this.forms.set(renamed.alias, forms);
    this.manualSecrets.delete(key);
    this.manualSecrets.set(name, renamed);
    if (renamed.isSecret) this.redactor.remember(forms);
    if (this.db.protectedStorage.cleanupPending) this.db.protectedStorage.clean();
    this.archived = this.archived.map(entry => entry.key === key ? { ...entry, key: name } : entry);
    renamed.retainedVersions = this.archived.filter(entry => entry.key === name).length;
    return renamed;
  };

  public pruneExpiredAutoSecrets = (now = Date.now()): number => AutoSecretStore.pruneExpired(this.db, this.autoSecrets, this.forms, now);

  public setAutoSecret = (key: string, realValue: string, description?: string): SecretEntry =>
    AutoSecretStore.create(this.db, this.autoSecrets, this.forms, this.entry(key, realValue, description), forms => this.redactor.remember(forms));

  public findByValue = (value: string): SecretEntry | undefined => [...this.manualSecrets.values(), ...this.autoSecrets.values()].find(entry => entry.realValue === value);

  public previewLabel = (value: string, prefix: string) => {
    const existing = this.findByValue(value);
    return { labelPrefix: prefix, alias: existing?.alias || '$${<' + prefix + '_' + this.db.aliases.randomSuffix() + '>}', existing: Boolean(existing), labelNotice: existing ? 'A label is already assigned to this value; the template will not change it.' : 'Group contents in the label are visible to the provider. The suffix is provisional; a new one will be assigned upon detection.' };
  };

  public registerAutoDetectedSecret = (realValue: string, type: string, prefix = LabelTemplate.prefix(type)): SecretEntry =>
    AutoSecretStore.register(this.db, this.autoSecrets, this.forms, this.findByValue, key => this.entry(key, realValue, 'Auto-detected ' + type), prefix, forms => this.redactor.remember(forms));

  public getManualSecrets = (): SecretEntry[] => [...this.manualSecrets.values()];
  public getAutoSecrets = (): SecretEntry[] => [...this.autoSecrets.values()];
  public listVariables = (input?: CatalogInput) => VariableCatalog.list(this.getManualSecrets().map(entry => ({ ...entry, description: this.redactor.redact(entry.description) })), this.getAutoSecrets().map(entry => ({ ...entry, description: this.redactor.redact(entry.description) })), input);
  public getRetention = () => ({ auto: 'sqlite-ttl-10d', ttlDays: 10, legacyCount: this.getAutoSecrets().filter(entry => entry.storage === 'legacy').length, cleanupPending: this.db.protectedStorage.cleanupPending, notice: 'Auto-secrets are stored in SQLite for 10 days (TTL from last detection). Protecting a manual entry does not erase external backups, snapshots, or prior export files; standard entries may retain plaintext on disk.' });

  public promote = (key: string): SecretEntry | null => {
    const auto = this.autoSecrets.get(key);
    if (!auto) return null;
    const isSecret = Boolean(auto.isSecret) || this.db.protectedStorage.isAvailable();
    const manual: SecretEntry = { ...auto, isSecret, storage: 'manual' as const, retainedVersions: this.archived.filter(version => version.key === key).length, updatedAt: new Date().toISOString() };
    const forms = this.db.aliases.transaction(() => {
      const allocated = this.db.manualBindings.bind(manual, true, this.db.aliases.owner(auto.alias));
      if (manual.isSecret) this.db.protectedStorage.markPending(true);
      this.persist(manual);
      this.db.deleteAutoSecret(key);
      if (manual.isSecret) this.db.protectedStorage.sanitizeDiagnostics(allocated);
      return allocated;
    });
    manual.representations = forms;
    this.forms.set(manual.alias, forms);
    this.autoSecrets.delete(key);
    this.manualSecrets.set(key, manual);
    if (manual.isSecret) this.redactor.remember(forms);
    if (this.db.protectedStorage.cleanupPending) this.db.protectedStorage.clean();
    return manual;
  };

  public deleteSecret = (key: string): boolean => {
    const entry = this.manualSecrets.get(key) || this.autoSecrets.get(key);
    if (!entry) return false;
    this.db.aliases.transaction(() => {
      this.db.deleteSecret(key); this.db.deleteAutoSecret(key);
      if (entry.storage !== 'manual') this.db.aliases.forget(entry.alias);
    });
    this.forms.delete(entry.alias);
    this.manualSecrets.delete(key);
    this.autoSecrets.delete(key);
    if (this.db.protectedStorage.cleanupPending) this.db.protectedStorage.clean();
    return true;
  };

  public getAllActiveSecrets = (): SecretEntry[] => [this.getManualSecrets(), this.getAutoSecrets()].flatMap(secrets => secrets.filter(secret => secret.maskInAi).sort((a, b) => b.realValue.length - a.realValue.length));
  private activeAliases = (): ReadonlySet<string> => new Set([...this.forms.values()].flatMap(forms => forms.map(form => form.alias)));
  public getSecretRepresentations = (secret: Pick<SecretEntry, 'alias'>): readonly SecretRepresentation[] => this.forms.get(secret.alias) || [];
  public getArchivedRepresentations = (row: SecretRow): readonly SecretRepresentation[] => this.db.archivedRepresentations.get(this.db.protectedStorage.decode(row));
  private historicalRedactions = (stored: SecretRow): SecretRepresentation[] => {
    const row = this.db.protectedStorage.decode(stored);
    const known = this.db.archivedRepresentations.get(row);
    return [...new Set(Object.values(VaultStore.computeVariants(row.real_value)))].filter(Boolean).map(value => ({ value, alias: known.find(form => form.value === value)?.alias || row.alias }));
  };
  public getInboundReplacements = (): Array<{ from: string; to: string; key?: string }> => [...this.manualSecrets.values(), ...this.autoSecrets.values()].flatMap(secret => this.getSecretRepresentations(secret).map(({ alias, value }) => ({ from: alias, to: value, key: secret.key })));
  public maskManualText = (text: string): string => TextReplacer.replace(text, this.getManualSecrets(), this.getSecretRepresentations);
  public maskOutboundText = (text: string): string => TextReplacer.replace(text, [...this.getManualSecrets(), ...this.getAutoSecrets()], this.getSecretRepresentations);
  public snapshot = () => {
    const replacements = this.getInboundReplacements();
    const inbound = new Map(replacements.map(({ from, to }) => [from, to]));
    const unmaskInboundText = (text: string) => TextReplacer.unmask(text, inbound);
    const inboundBytes = replacements.reduce((bytes, { from, to, key }) => bytes + 256 + 2 * (from.length + to.length + (key?.length || 0)), 256);
    return { getInboundReplacements: () => replacements, unmaskInboundText, diagnostics: this.redactor.snapshot(unmaskInboundText, inboundBytes) };
  };
  public unmaskInboundText = (text: string): string => TextReplacer.unmask(text, new Map(this.getInboundReplacements().map(({ from, to }) => [from, to])));
  public unmaskObject = <T>(obj: T): T => TextReplacer.unmaskObject(obj, this.unmaskInboundText);
}
