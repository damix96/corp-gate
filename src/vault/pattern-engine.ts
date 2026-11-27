import { RE2JS } from 're2js';
import { VaultDatabase, PatternRow } from './sqlite-db.js';
import { AnyIpRule } from './any-ip-rule.js';
import { EnvLikeRule } from './env-like-rule.js';
import { LabelTemplate } from './label-template.js';

interface CompiledPattern {
  row: PatternRow;
  regex: RE2JS;
}

const INTERNAL_URLS_PATTERN = 'https?:\\/\\/[a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*\\.(?:internal|local|corp|lan|intranet)\\b(?:\\.[a-zA-Z0-9_-]+)*(?::\\d{1,5})?(?:\\/[^\\s"\'`<>\\);,]*)?';
const DATABASE_URI_PATTERN = '(?:postgres|postgresql|mysql|mongodb|redis):\\/\\/[^\\s"\'`),;<>]+';
const API_KEYS_PATTERN = '(?:\\bAKIA[0-9A-Z]{16}\\b|\\bgithub_pat_[a-zA-Z0-9_]{20,}|\\bglpat-[a-zA-Z0-9_-]{20,}|\\bxox[baprs]-[a-zA-Z0-9-]{10,}|\\bAIza[0-9A-Za-z_-]{30,}|\\bsk_live_[0-9a-zA-Z]{16,}|\\brk_live_[0-9a-zA-Z]{16,}|\\bsk-[a-zA-Z0-9_-]{20,}|\\bghp_[a-zA-Z0-9]{20,}|\\bbearer\\s+([a-zA-Z0-9_\\-\\.]{20,}))';

export class PatternEngine {
  private db: VaultDatabase;
  private compiled = new Map<string, RE2JS>();
  private cachedActive: CompiledPattern[] | null = null;
  private cachedVersion = -1;

  constructor(db: VaultDatabase) {
    this.db = db;
    this.initializeDefaultPatterns();
    AnyIpRule.install(db);
    EnvLikeRule.install(db);
  }

  private compile = (pattern: string): RE2JS => {
    let regex = this.compiled.get(pattern);
    if (!regex) {
      regex = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
      this.compiled.set(pattern, regex);
    }
    return regex;
  };

  private initializeDefaultPatterns = (): void => {
    if (this.db.getPatterns().length > 0) return;
    const now = new Date().toISOString();
    const defaults: PatternRow[] = [
      { id: 'pat_internal_urls', name: 'internal-urls', pattern: INTERNAL_URLS_PATTERN, type: 'url', enabled: 1, created_at: now },
      { id: 'pat_database_uri', name: 'database-uri', pattern: DATABASE_URI_PATTERN, type: 'uri', enabled: 1, created_at: now },
      { id: AnyIpRule.privateId, name: 'private-ip', pattern: AnyIpRule.pattern, type: 'ip', enabled: 1, created_at: now },
      { id: 'pat_api_keys', name: 'api-keys', pattern: API_KEYS_PATTERN, type: 'token', enabled: 1, created_at: now },
    ];
    defaults.forEach(p => this.db.upsertPattern(p));
    this.db.setSetting('rule_private_ip_rfc1918_v2', '1');
  };

  public static validateRegex = (pat: string): string | null => {
    try {
      RE2JS.compile(pat, RE2JS.CASE_INSENSITIVE);
      return null;
    } catch (error) {
      return 'Invalid or unsupported RE2 expression (lookahead, lookbehind, and backreferences are not supported): ' + (error instanceof Error ? error.message : String(error));
    }
  };

  public static isValidRegex = (pat: string): boolean => PatternEngine.validateRegex(pat) === null;

  public invalidateCache = (): void => {
    this.cachedActive = null;
    this.cachedVersion = -1;
  };

  private getActivePatterns = (): CompiledPattern[] => {
    const version = this.db.getPatternsVersion();
    if (this.cachedActive && this.cachedVersion === version) return this.cachedActive;
    const active: CompiledPattern[] = [];
    for (const row of this.db.getPatterns()) {
      if (row.enabled !== 1) continue;
      LabelTemplate.validate(row.pattern, row.label_template);
      active.push({ row, regex: this.compile(row.pattern) });
    }
    this.cachedActive = active;
    this.cachedVersion = version;
    return active;
  };

  public getPatterns = (): PatternRow[] => this.db.getPatterns();

  public addPattern = (name: string, pattern: string, type: string = 'custom', label_template: string | null = null): PatternRow | null => {
    if (!PatternEngine.isValidRegex(pattern)) return null;
    LabelTemplate.validate(pattern, label_template);
    const id = 'pat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const row: PatternRow = { id, name, pattern, type, label_template, enabled: 1, created_at: new Date().toISOString() };
    this.db.upsertPattern(row);
    this.invalidateCache();
    return row;
  };

  public deletePattern = (id: string): boolean => {
    const deleted = this.db.deletePattern(id);
    if (deleted) this.invalidateCache();
    return deleted;
  };

  public updatePattern = (id: string, draft: Pick<PatternRow, 'name' | 'pattern' | 'type' | 'enabled' | 'label_template'>): PatternRow | null => {
    const current = this.db.getPatterns().find(row => row.id === id);
    if (!current || !PatternEngine.isValidRegex(draft.pattern)) return null;
    LabelTemplate.validate(draft.pattern, draft.label_template === undefined ? current.label_template : draft.label_template);
    const updated = { ...current, ...draft };
    this.db.upsertPattern(updated);
    this.invalidateCache();
    return updated;
  };

  public togglePattern = (id: string): PatternRow | null => {
    const toggled = this.db.togglePattern(id);
    if (toggled) this.invalidateCache();
    return toggled;
  };

  public scanAndAutoDetect = (text: string, onSecretDetected: (match: string, type: string, prefix?: string) => void): void => {
    for (const { row: pat, regex } of this.getActivePatterns()) {
      const seen = new Set<string>();
      for (const match of regex.matchAll(text)) {
        if (pat.id === EnvLikeRule.id) {
          const extracted = EnvLikeRule.extract(match);
          if (!extracted || seen.has(extracted.value)) continue;
          seen.add(extracted.value);
          onSecretDetected(extracted.value, pat.type, extracted.prefix);
          continue;
        }
        const value = (pat.id === 'pat_api_keys' ? (match[1] ?? match[0]) : match[0]).trim();
        const index = match.index ?? 0;
        if (seen.has(value) || value.includes('$${<') || value.includes('>}')) continue;
        if (pat.id === AnyIpRule.id || pat.id === AnyIpRule.privateId) {
          if (!AnyIpRule.isPrivateIp(value) || !AnyIpRule.hasCleanBoundaries(text, index, index + match[0].length)) continue;
        } else if (value.length <= 3) continue;
        seen.add(value);
        onSecretDetected(value, pat.type, LabelTemplate.prefix(pat.type, pat.label_template, match));
      }
    }
  };
}
