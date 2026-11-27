import type { SecretRecord, SessionStep } from '../stores/types.js';
import { SessionPayload } from './session-payload.js';

export interface SessionAlias { key: string; alias: string; realValue?: string; format?: string; valueHidden?: boolean; known: boolean; count?: number; }

export class SessionAliases {
  static knownCount = (item: SessionAlias): number | undefined => typeof item.count === 'number' && Number.isFinite(item.count) && item.count >= 0 ? item.count : undefined;

  static frequency = (entries: SessionAlias[]): SessionAlias[] => {
    const count = (item: SessionAlias) => SessionAliases.knownCount(item) ?? -1;
    return [...entries].sort((a, b) => count(b) - count(a) || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  };

  entries = new Map<string, SessionAlias>();

  constructor(step: SessionStep, records: SecretRecord[] = []) {
    for (const secret of [...records, ...(step.interceptedSecrets || [])]) {
      const hidden = Boolean('valueHidden' in secret && secret.valueHidden);
      this.entries.set(secret.alias, { key: secret.key, alias: secret.alias, realValue: hidden ? undefined : secret.realValue, valueHidden: hidden, known: true });
      for (const rep of secret.representations || []) this.entries.set(rep.alias, { key: secret.key, alias: rep.alias, realValue: hidden ? undefined : rep.value, format: rep.format, valueHidden: hidden, known: true });
    }
  }

  matcher = (): RegExp => new RegExp([...this.entries.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).concat('\\$\\$\\{<[^<>]+>\\}').join('|'), 'g');

  used = (body: unknown): SessionAlias[] => {
    const counts = new Map<string, number>();
    for (const field of SessionPayload.decodedFields(body)) for (const match of field.text.matchAll(this.matcher())) counts.set(match[0], (counts.get(match[0]) || 0) + 1);
    return [...counts].map(([alias, count]) => ({ ...(this.entries.get(alias) || { alias, key: alias.slice(4, -2), known: false }), count }));
  };
}
