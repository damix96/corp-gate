import { isIP } from 'node:net';
import { VaultDatabase } from './sqlite-db.js';

export class AnyIpRule {
  static id = 'pat_any_ip';
  static privateId = 'pat_private_ip';
  static pattern = '\\b(?:10(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}|192\\.168(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){2}|172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){2})(?::\\d{1,5})?\\b';

  static isPrivateIp = (value: string): boolean => {
    const colon = value.lastIndexOf(':');
    const host = colon > -1 ? value.slice(0, colon) : value;
    if (colon > -1) {
      const port = Number(value.slice(colon + 1));
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    }
    if (isIP(host) !== 4) return false;
    const [a, b] = host.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };

  static hasCleanBoundaries = (text: string, start: number, end: number): boolean =>
    (start === 0 || !/[\w.]/.test(text[start - 1])) && (end >= text.length || !/[\w.]/.test(text[end]));

  static install = (db: VaultDatabase): void => {
    const patterns = db.getPatterns();
    const existingAny = patterns.find(rule => rule.id === AnyIpRule.id);
    const existingPrivate = patterns.find(rule => rule.id === AnyIpRule.privateId);
    if (existingAny && existingPrivate) {
      db.deletePattern(AnyIpRule.id);
      if (db.getSetting('rule_private_ip_rfc1918_v2', '') !== '1') {
        db.upsertPattern({ ...existingPrivate, pattern: AnyIpRule.pattern });
        db.setSetting('rule_private_ip_rfc1918_v2', '1');
      }
      return;
    }
    if (existingPrivate && db.getSetting('rule_private_ip_rfc1918_v2', '') !== '1') {
      db.upsertPattern({ ...existingPrivate, pattern: AnyIpRule.pattern });
      db.setSetting('rule_private_ip_rfc1918_v2', '1');
    }
    if (existingAny && db.getSetting('rule_any_ip_rfc1918_v2', '') !== '1') {
      db.upsertPattern({ ...existingAny, pattern: AnyIpRule.pattern });
      db.setSetting('rule_any_ip_rfc1918_v1', '1');
      db.setSetting('rule_any_ip_rfc1918_v2', '1');
    }
  };
}
