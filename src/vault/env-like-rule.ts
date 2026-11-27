import { VaultDatabase } from './sqlite-db.js';
import { LabelTemplate } from './label-template.js';

export class EnvLikeRule {
  static id = 'pat_env_like';
  static labelTemplate = 'AUTO_ENV_$1';
  static pattern = '\\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|AUTH|CREDENTIAL|DSN|CONNECTION_STRING)[A-Z0-9_]*)[ \\t]*=[ \\t]*(?:"([^"\\r\\n]{8,})"|\'([^\'\\r\\n]{8,})\'|([^\\s"\'`\\r\\n]{8,}))';
  private static exactJunk = new Set(['changeme', 'example', 'placeholder', 'dummy', 'test', 'localhost', 'true', 'false', 'null']);
  private static metadataSuffixes = ['_HEADER', '_TYPE', '_MODE', '_PATH', '_DIR', '_FILE', '_NAME', '_FIELD', '_LABEL', '_PREFIX', '_SUFFIX', '_FORMAT', '_ALGORITHM', '_TTL', '_TIMEOUT', '_ENABLED', '_FLAG'];
  private static codePrefixes = ['process.env.', 'os.environ', 'os.getenv', 'config.', 'settings.', 'this.', 'self.', 'env.', 'req.', 'res.'];

  static install = (db: VaultDatabase): void => {
    if (db.getSetting('rule_env_like_installed', '') === '1') return;
    if (!db.getPatterns().some(rule => rule.id === EnvLikeRule.id)) {
      db.upsertPattern({ id: EnvLikeRule.id, name: 'env-like', pattern: EnvLikeRule.pattern, type: 'env', label_template: EnvLikeRule.labelTemplate, enabled: 1, created_at: new Date().toISOString() });
    }
    db.setSetting('rule_env_like_installed', '1');
  };

  static extract = (match: RegExpMatchArray): { value: string; prefix: string } | null => {
    const name = match[1] || '';
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name) || value.length < 8) return null;
    if (EnvLikeRule.metadataSuffixes.some(suffix => name.endsWith(suffix))) return null;
    if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')) return null;
    if (value.length < 16 && /^[a-zA-Z_]+$/.test(value)) return null;
    if (value.includes('$${<') || value.includes('>}')) return null;
    if (value.startsWith('$') || /\$\{[^}]*\}/.test(value)) return null;
    const lower = value.toLowerCase();
    if (/[()[\]]/.test(value) || EnvLikeRule.codePrefixes.some(prefix => lower.startsWith(prefix))) return null;
    if (EnvLikeRule.exactJunk.has(lower)) return null;
    if (lower.startsWith('your_') || lower.includes('changeme') || lower.includes('example') || lower.includes('placeholder') || lower.includes('dummy') || value.includes('***') || /^[*x_.\-]+$/i.test(value)) return null;
    if (/^(?:test|testing)[_-]?(?:key|token|pass|password|secret|value|123+)?$/i.test(value)) return null;
    return { value, prefix: LabelTemplate.normalize('AUTO_ENV_' + name) };
  };
}
