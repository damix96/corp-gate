import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { RuntimeSettings } from '../runtime/settings.js';
import { DiscoveredEndpoint } from './init-discovery.js';
import { InitRecoveryStore } from './init-recovery.js';

interface RouteSummary { id: string; prefix: string; upstreamUrl: string; cliUrl: string }
export interface AppliedEndpointResult { endpoint: DiscoveredEndpoint; status: 'applied' | 'manual'; prefix: string; corpGateUrl: string; backupPath?: string; manualInstruction?: string; error?: string }
export interface InitApplierOptions { settings: RuntimeSettings; recovery: InitRecoveryStore; adminToken: string; fetchImpl?: typeof fetch; platform?: NodeJS.Platform }

export class InitEndpointApplier {
  private fetchImpl: typeof fetch;
  private platform: NodeJS.Platform;
  private tmpCounter = 0;

  constructor(private options: InitApplierOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.platform = options.platform ?? process.platform;
  }

  public apply = async (endpoints: DiscoveredEndpoint[]): Promise<AppliedEndpointResult[]> => {
    const routes = await this.fetchRoutes();
    const backedUp = new Map<string, string>();
    const results: AppliedEndpointResult[] = [];
    for (const endpoint of endpoints) {
      const route = await this.ensureRoute(endpoint, routes);
      const corpGateUrl = `${this.options.settings.url}/${route.prefix}`;
      const timestamp = new Date().toISOString();
      if (!endpoint.editable || endpoint.sourceKind === 'env' || !endpoint.filePath) {
        results.push(this.recordManualResult(endpoint, route.prefix, corpGateUrl, timestamp));
        continue;
      }
      try {
        const backupPath = this.ensureBackup(endpoint.filePath, backedUp);
        if (endpoint.sourceKind === 'json') this.applyJson(endpoint.filePath, endpoint.fieldPath, corpGateUrl);
        else this.applyToml(endpoint.filePath, endpoint.fieldPath, corpGateUrl);
        this.options.recovery.recordBackup({ id: endpoint.id, client: endpoint.client, filePath: endpoint.filePath, backupPath, originalUrl: endpoint.currentUrl, corpGateUrl, prefix: route.prefix, timestamp });
        results.push({ endpoint, status: 'applied', prefix: route.prefix, corpGateUrl, backupPath });
      } catch (error) {
        results.push(this.recordManualResult(endpoint, route.prefix, corpGateUrl, timestamp, (error as Error).message));
      }
    }
    return results;
  };

  private recordManualResult = (endpoint: DiscoveredEndpoint, prefix: string, corpGateUrl: string, timestamp: string, error?: string): AppliedEndpointResult => {
    const manualInstruction = this.manualCommand(endpoint, corpGateUrl);
    this.options.recovery.recordManual({ id: endpoint.id, client: endpoint.client, sourceLabel: endpoint.sourceLabel, envKey: endpoint.envKey, originalUrl: endpoint.currentUrl, corpGateUrl, prefix, instruction: manualInstruction, timestamp });
    return { endpoint, status: 'manual', prefix, corpGateUrl, manualInstruction, ...(error ? { error } : {}) };
  };

  private ensureBackup = (filePath: string, backedUp: Map<string, string>): string => {
    const key = this.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);
    const existing = backedUp.get(key);
    if (existing) return existing;
    const created = this.options.recovery.backupFile(filePath);
    backedUp.set(key, created);
    return created;
  };

  private fetchRoutes = async (): Promise<RouteSummary[]> => {
    const res = await this.fetchImpl(this.options.settings.url + '/api/routes', {
      headers: { authorization: 'Bearer ' + this.options.adminToken },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error('Failed to fetch CorpGate routes: HTTP ' + res.status);
    return await res.json() as RouteSummary[];
  };

  private ensureRoute = async (endpoint: DiscoveredEndpoint, routes: RouteSummary[]): Promise<RouteSummary> => {
    const normalizedUpstream = endpoint.currentUrl.trim().replace(/\/+$/, '');
    const headers = { authorization: 'Bearer ' + this.options.adminToken, 'content-type': 'application/json' };
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const prefix = attempt === 1 ? endpoint.suggestedPrefix : `${endpoint.suggestedPrefix}-${attempt}`;
      const existing = routes.find(r => r.prefix === prefix);
      if (existing) {
        if (existing.upstreamUrl.replace(/\/+$/, '') === normalizedUpstream) {
          const updatedRes = await this.fetchImpl(`${this.options.settings.url}/api/routes/${encodeURIComponent(existing.id)}`, {
            method: 'PUT', headers, body: JSON.stringify({ upstreamUrl: normalizedUpstream, proxyMode: 'direct' }),
            signal: AbortSignal.timeout(5000), redirect: 'error',
          });
          if (!updatedRes.ok) throw new Error('Failed to update CorpGate route: HTTP ' + updatedRes.status);
          const updated = await updatedRes.json() as RouteSummary;
          const idx = routes.findIndex(r => r.id === existing.id);
          if (idx >= 0) routes[idx] = updated;
          return updated;
        }
        continue;
      }
      const createRes = await this.fetchImpl(this.options.settings.url + '/api/routes', {
        method: 'POST', headers,
        body: JSON.stringify({ name: endpoint.client, prefix, upstreamUrl: normalizedUpstream, description: 'Imported by corp-gate init (' + endpoint.sourceLabel + ')', proxyMode: 'direct' }),
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (createRes.status === 400) {
        const body = await createRes.json().catch(() => ({})) as { error?: string };
        if (String(body.error || '').includes('already in use')) continue;
        throw new Error(body.error || 'Failed to create CorpGate route');
      }
      if (!createRes.ok) throw new Error('Failed to create CorpGate route: HTTP ' + createRes.status);
      const created = await createRes.json() as RouteSummary;
      routes.push(created);
      return created;
    }
    throw new Error('Could not allocate unique route prefix for ' + endpoint.suggestedPrefix);
  };

  private applyJson = (filePath: string, fieldPath: string[], corpGateUrl: string): void => {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || fieldPath.length === 0) throw new Error('Invalid JSON structure');
    let cursor = parsed as Record<string, unknown>;
    for (let i = 0; i < fieldPath.length - 1; i += 1) {
      const next = cursor[fieldPath[i]];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error('Target JSON path missing');
      cursor = next as Record<string, unknown>;
    }
    const leaf = fieldPath[fieldPath.length - 1];
    if (typeof cursor[leaf] !== 'string') throw new Error('Target JSON field is not a string');
    cursor[leaf] = corpGateUrl;
    const eol = raw.endsWith('\n') ? '\n' : '';
    this.writeAtomic(filePath, JSON.stringify(parsed, null, 2) + eol);
  };

  private applyToml = (filePath: string, fieldPath: string[], corpGateUrl: string): void => {
    const raw = readFileSync(filePath, 'utf8');
    const updated = this.replaceTomlStringValue(raw, fieldPath, corpGateUrl);
    const verified = parseToml(updated) as Record<string, unknown>;
    let cursor: unknown = verified;
    for (const seg of fieldPath) {
      if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) throw new Error('TOML verification failed');
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    if (cursor !== corpGateUrl) throw new Error('TOML verification mismatch');
    this.writeAtomic(filePath, updated);
  };

  private replaceTomlStringValue = (raw: string, fieldPath: string[], newValue: string): string => {
    const segments = raw.match(/[^\r\n]*(?:\r\n|\n|\r)?/g) ?? [];
    let currentSection: string[] = [];
    let multiline: '"""' | "'''" | null = null;
    let replaced = false;
    const out = segments.map(segment => {
      if (!segment || replaced || multiline) {
        if (multiline && segment.includes(multiline)) multiline = null;
        return segment;
      }
      const match = segment.match(/^([^\r\n]*)(\r\n|\n|\r)?$/);
      const line = match ? match[1] : segment;
      const eol = match?.[2] ?? '';
      const [code, comment] = this.splitTomlComment(line);
      const trimmed = code.trim();
      if (!trimmed) return segment;
      if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) { currentSection = this.parseTomlKeys(trimmed.slice(2, -2)); return segment; }
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) { currentSection = this.parseTomlKeys(trimmed.slice(1, -1)); return segment; }
      const eqIdx = this.indexOutsideQuotes(code, '=');
      if (eqIdx <= 0) return segment;
      const lhs = code.slice(0, eqIdx);
      const rhs = code.slice(eqIdx + 1);
      const fullPath = [...currentSection, ...this.parseTomlKeys(lhs)];
      if (fullPath.length !== fieldPath.length || fullPath.some((part, i) => part !== fieldPath[i])) {
        const rhsTrim = rhs.trimStart();
        if (rhsTrim.startsWith('"""') && rhsTrim.indexOf('"""', 3) < 0) multiline = '"""';
        else if (rhsTrim.startsWith("'''") && rhsTrim.indexOf("'''", 3) < 0) multiline = "'''";
        return segment;
      }
      const rhsMatch = rhs.match(/^(\s*)(?:"(?:[^"\\]|\\.)*"|'[^']*')(\s*)$/);
      if (!rhsMatch) throw new Error('Unsupported TOML value format for ' + fieldPath.join('.'));
      replaced = true;
      return `${lhs}=${rhsMatch[1]}${JSON.stringify(newValue)}${rhsMatch[2]}${comment}${eol}`;
    });
    if (!replaced) throw new Error('Target TOML key not found: ' + fieldPath.join('.'));
    return out.join('');
  };

  private splitTomlComment = (line: string): [string, string] => {
    const idx = this.indexOutsideQuotes(line, '#');
    return idx >= 0 ? [line.slice(0, idx), line.slice(idx)] : [line, ''];
  };

  private indexOutsideQuotes = (text: string, target: string): number => {
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote === '"') { if (ch === '\\') { i += 1; continue; } if (ch === '"') quote = null; continue; }
      if (quote === "'") { if (ch === "'") quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === target) return i;
    }
    return -1;
  };

  private parseTomlKeys = (raw: string): string[] => {
    const keys: string[] = [];
    let i = 0;
    while (i < raw.length) {
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '.')) i += 1;
      if (i >= raw.length) break;
      if (raw[i] === '"' || raw[i] === "'") {
        const q = raw[i];
        i += 1;
        let value = '';
        while (i < raw.length && raw[i] !== q) {
          if (q === '"' && raw[i] === '\\' && i + 1 < raw.length) { value += raw[i + 1]; i += 2; continue; }
          value += raw[i];
          i += 1;
        }
        i += 1;
        keys.push(value);
      } else {
        const start = i;
        while (i < raw.length && raw[i] !== '.' && raw[i] !== ' ' && raw[i] !== '\t') i += 1;
        keys.push(raw.slice(start, i));
      }
    }
    return keys;
  };

  private manualCommand = (endpoint: DiscoveredEndpoint, corpGateUrl: string): string => {
    if (endpoint.envKey) {
      return this.platform === 'win32'
        ? `$env:${endpoint.envKey}="${corpGateUrl}"`
        : `export ${endpoint.envKey}="${corpGateUrl}"`;
    }
    return `Update ${endpoint.fieldPath.join('.')} in ${endpoint.sourceLabel} to ${corpGateUrl}`;
  };

  private writeAtomic = (targetPath: string, content: string): void => {
    this.tmpCounter += 1;
    const tmp = `${targetPath}.corpgate-${process.pid}-${Date.now()}-${this.tmpCounter}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    try { renameSync(tmp, targetPath); }
    finally { rmSync(tmp, { force: true }); }
  };
}
