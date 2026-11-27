import type { SecretRecord } from '../stores/types.js';

export interface DetectionGroup { id: string; prefix: string; records: SecretRecord[]; hits: number; unknownHits: number; }

export class DetectionGroups {
  static prefix = (key: string): string => key.lastIndexOf('_') > 0 ? key.slice(0, key.lastIndexOf('_')) : '';

  static build = (records: SecretRecord[]): DetectionGroup[] => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const prefix = DetectionGroups.prefix(record.key);
      if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
    const groups = new Map<string, DetectionGroup>();
    for (const record of records) {
      const prefix = DetectionGroups.prefix(record.key);
      const grouped = Boolean(prefix && (counts.get(prefix) || 0) > 1);
      const id = grouped ? `prefix:${prefix}` : `record:${record.key}`;
      if (!groups.has(id)) groups.set(id, { id, prefix: grouped ? prefix : '', records: [], hits: 0, unknownHits: 0 });
      const group = groups.get(id)!;
      group.records.push(record);
      if (Number.isSafeInteger(record.hitCount) && record.hitCount! >= 0 && Number.isSafeInteger(group.hits + record.hitCount!)) group.hits += record.hitCount!; else group.unknownHits++;
    }
    return [...groups.values()];
  };
}
