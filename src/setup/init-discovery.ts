import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export type EndpointSourceKind = 'env' | 'json' | 'toml';
export type EndpointApiFormat = 'anthropic' | 'openai' | 'gemini';

export interface EndpointDiscoveryOptions {
  homeDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  corpGatePort?: number;
}

export interface DiscoveredEndpoint {
  id: string;
  client: string;
  sourceKind: EndpointSourceKind;
  editable: boolean;
  apiFormat: EndpointApiFormat;
  sourceLabel: string;
  filePath?: string;
  envKey?: string;
  fieldPath: string[];
  currentUrl: string;
  suggestedPrefix: string;
}

const RESERVED_PREFIXES = new Set(['api', 'health', 'dashboard', 'zen']);
const ENV_SOURCES: Array<{ key: string; client: string; apiFormat: EndpointApiFormat; baseSlug: string }> = [
  { key: 'ANTHROPIC_BASE_URL', client: 'Anthropic Env', apiFormat: 'anthropic', baseSlug: 'env-anthropic' },
  { key: 'OPENAI_BASE_URL', client: 'OpenAI Env', apiFormat: 'openai', baseSlug: 'env-openai' },
  { key: 'OPENAI_API_BASE', client: 'OpenAI Legacy Env', apiFormat: 'openai', baseSlug: 'env-openai-api' },
  { key: 'GEMINI_API_BASE', client: 'Gemini Env', apiFormat: 'gemini', baseSlug: 'env-gemini' },
  { key: 'GOOGLE_GEMINI_BASE_URL', client: 'Google Gemini Env', apiFormat: 'gemini', baseSlug: 'env-google-gemini' },
];

export class ClientEndpointDiscovery {
  private homeDir: string;
  private cwd: string;
  private env: NodeJS.ProcessEnv;
  private corpGatePort: number;

  constructor(options: EndpointDiscoveryOptions = {}) {
    this.homeDir = path.resolve(options.homeDir ?? os.homedir());
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.env = options.env ?? process.env;
    this.corpGatePort = options.corpGatePort ?? 8767;
  }

  public discover = (): DiscoveredEndpoint[] => {
    const found: DiscoveredEndpoint[] = [];
    const usedPrefixes = new Set<string>();
    const seenFiles = new Set<string>();
    const push = (item: Omit<DiscoveredEndpoint, 'id' | 'suggestedPrefix'>, baseSlug: string): void => {
      const currentUrl = item.currentUrl.trim();
      if (!this.isValidExternalUrl(currentUrl)) return;
      const suggestedPrefix = this.uniquePrefix(baseSlug, usedPrefixes);
      found.push({ ...item, currentUrl, id: 'endpoint-' + (found.length + 1), suggestedPrefix });
    };
    this.scanEnv(push);
    this.scanClaude(seenFiles, push);
    this.scanOpenCode(seenFiles, push);
    this.scanCodex(seenFiles, push);
    return found;
  };

  private scanEnv = (push: (item: Omit<DiscoveredEndpoint, 'id' | 'suggestedPrefix'>, baseSlug: string) => void): void => {
    for (const entry of ENV_SOURCES) {
      const value = this.env[entry.key];
      if (typeof value !== 'string' || !value.trim()) continue;
      push({ client: entry.client, sourceKind: 'env', editable: false, apiFormat: entry.apiFormat, sourceLabel: 'env:' + entry.key, envKey: entry.key, fieldPath: [entry.key], currentUrl: value }, entry.baseSlug);
    }
  };

  private scanClaude = (seenFiles: Set<string>, push: (item: Omit<DiscoveredEndpoint, 'id' | 'suggestedPrefix'>, baseSlug: string) => void): void => {
    const candidates = [
      path.join(this.homeDir, '.claude', 'settings.json'),
      path.join(this.cwd, '.claude', 'settings.json'),
      path.join(this.cwd, '.claude', 'settings.local.json'),
    ];
    for (const filePath of candidates) {
      const data = this.readJson(filePath, seenFiles);
      const envObj = this.asRecord(data?.env);
      const url = envObj?.ANTHROPIC_BASE_URL;
      if (typeof url === 'string' && url.trim()) {
        push({ client: 'Claude Code', sourceKind: 'json', editable: true, apiFormat: 'anthropic', sourceLabel: this.displayPath(filePath), filePath, fieldPath: ['env', 'ANTHROPIC_BASE_URL'], currentUrl: url }, 'claude-corp');
      }
    }
  };

  private scanOpenCode = (seenFiles: Set<string>, push: (item: Omit<DiscoveredEndpoint, 'id' | 'suggestedPrefix'>, baseSlug: string) => void): void => {
    const candidates = [
      path.join(this.homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(this.cwd, 'opencode.json'),
    ];
    for (const filePath of candidates) {
      const data = this.readJson(filePath, seenFiles);
      const providers = this.asRecord(data?.provider);
      if (!providers) continue;
      for (const [name, rawProvider] of Object.entries(providers)) {
        const provider = this.asRecord(rawProvider);
        const options = this.asRecord(provider?.options);
        if (!options) continue;
        const key = typeof options.baseURL === 'string' && options.baseURL.trim() ? 'baseURL' : (typeof options.baseUrl === 'string' && options.baseUrl.trim() ? 'baseUrl' : '');
        if (!key) continue;
        push({ client: 'OpenCode (' + name + ')', sourceKind: 'json', editable: true, apiFormat: 'openai', sourceLabel: this.displayPath(filePath), filePath, fieldPath: ['provider', name, 'options', key], currentUrl: String(options[key]) }, 'opencode-' + name);
      }
    }
  };

  private scanCodex = (seenFiles: Set<string>, push: (item: Omit<DiscoveredEndpoint, 'id' | 'suggestedPrefix'>, baseSlug: string) => void): void => {
    const filePath = path.join(this.homeDir, '.codex', 'config.toml');
    const data = this.readToml(filePath, seenFiles);
    if (!data) return;
    for (const key of ['openai_base_url', 'base_url'] as const) {
      const url = data[key];
      if (typeof url === 'string' && url.trim()) {
        push({ client: 'Codex CLI', sourceKind: 'toml', editable: true, apiFormat: 'openai', sourceLabel: this.displayPath(filePath), filePath, fieldPath: [key], currentUrl: url }, 'codex-corp');
      }
    }
    const providers = this.asRecord(data.model_providers);
    if (!providers) return;
    for (const [name, rawProvider] of Object.entries(providers)) {
      const provider = this.asRecord(rawProvider);
      const url = provider?.base_url;
      if (typeof url === 'string' && url.trim()) {
        push({ client: 'Codex CLI (' + name + ')', sourceKind: 'toml', editable: true, apiFormat: 'openai', sourceLabel: this.displayPath(filePath), filePath, fieldPath: ['model_providers', name, 'base_url'], currentUrl: url }, 'codex-' + name);
      }
    }
  };

  private readJson = (filePath: string, seenFiles: Set<string>): Record<string, unknown> | undefined => {
    const raw = this.readOnce(filePath, seenFiles);
    if (raw === undefined) return undefined;
    try { return this.asRecord(JSON.parse(raw)); }
    catch { return undefined; }
  };

  private readToml = (filePath: string, seenFiles: Set<string>): Record<string, unknown> | undefined => {
    const raw = this.readOnce(filePath, seenFiles);
    if (raw === undefined) return undefined;
    try { return this.asRecord(parseToml(raw)); }
    catch { return undefined; }
  };

  private readOnce = (filePath: string, seenFiles: Set<string>): string | undefined => {
    const resolved = path.resolve(filePath);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seenFiles.has(key)) return undefined;
    seenFiles.add(key);
    if (!existsSync(resolved)) return undefined;
    try { return readFileSync(resolved, 'utf8'); }
    catch { return undefined; }
  };

  private asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

  private isValidExternalUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
      const isLocal = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && Number(parsed.port || 80) === this.corpGatePort;
      return !isLocal;
    } catch { return false; }
  };

  private uniquePrefix = (raw: string, used: Set<string>): string => {
    let base = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'corp-route';
    if (RESERVED_PREFIXES.has(base)) base = base + '-corp';
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) { candidate = base + '-' + index; index += 1; }
    used.add(candidate);
    return candidate;
  };

  private displayPath = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    const prefix = this.homeDir + path.sep;
    if (resolved.startsWith(prefix)) return '~/' + resolved.slice(prefix.length).replaceAll('\\', '/');
    const rel = path.relative(this.cwd, resolved);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replaceAll('\\', '/') : resolved;
  };
}
