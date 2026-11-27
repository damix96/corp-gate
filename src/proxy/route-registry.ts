import { z } from 'zod';
import { VaultDatabase } from '../vault/sqlite-db.js';
import type { ProxyMode } from '../vault/database-types.js';
import { OpenCodeConfig } from './opencode-config.js';
import { RouteAvailability } from './route-availability.js';

export const routeProxySchema = z.object({
  proxyMode: z.enum(['direct', 'system', 'custom']).optional(),
  httpProxy: z.string().max(2048).optional(),
  httpsProxy: z.string().max(2048).optional(),
  noProxy: z.string().max(4096).optional(),
});

export interface RouteProxyConfig {
  proxyMode?: ProxyMode;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface RouteDefinition {
  id: string;
  name: string;
  prefix: string;
  cliUrl: string;
  suffix: string;
  upstreamUrl: string;
  commandExample: string;
  description: string;
  isCustom: boolean;
  isUnusedPreset: boolean;
  proxyMode: ProxyMode;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export class RouteRegistry {
  constructor(private db: VaultDatabase, private hostPort: string = 'http://127.0.0.1:8767', private hasHistory: (prefix: string) => boolean = () => false) {}

  public static validateUrl = (value: string): string => {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Specify an HTTP(S) URL without credentials, query, or fragment');
    return url.href.replace(/\/+$/, '');
  };

  public static validateProxyUrl = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/[\r\n\0\s]/.test(trimmed)) throw new Error('Invalid proxy URL');
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Specify an HTTP(S) proxy URL');
    return trimmed.replace(/\/+$/, '');
  };

  public static validateProxy = (raw: unknown): RouteProxyConfig => {
    const parsed = routeProxySchema.parse(raw);
    if (parsed.noProxy !== undefined && /[\r\n\0]/.test(parsed.noProxy)) throw new Error('Invalid NO_PROXY value');
    return {
      ...(parsed.proxyMode !== undefined ? { proxyMode: parsed.proxyMode } : {}),
      ...(parsed.httpProxy !== undefined ? { httpProxy: RouteRegistry.validateProxyUrl(parsed.httpProxy) } : {}),
      ...(parsed.httpsProxy !== undefined ? { httpsProxy: RouteRegistry.validateProxyUrl(parsed.httpsProxy) } : {}),
      ...(parsed.noProxy !== undefined ? { noProxy: parsed.noProxy.trim() } : {}),
    };
  };

  public getRoutes = (baseUrl: string = this.hostPort): RouteDefinition[] =>
    this.db.getAllRoutes().map(r => {
      const suffix = this.db.getSetting('route_suffix_' + r.id, '');
      const cliUrl = baseUrl + '/' + r.prefix + suffix;
      const providerId = r.id === 'opencode' ? 'corpgate-zen' : (r.id === 'opencode-go' ? 'corpgate-go' : 'corpgate-test');
      const modelId = r.prefix === 'corpgate-test' ? 'zen-mock' : 'YOUR_MODEL_ID';
      const commandExample = r.id.startsWith('opencode') || r.prefix === 'corpgate-test'
        ? JSON.stringify(OpenCodeConfig.create({ id: providerId, name: r.name + ' via CorpGate', baseUrl: cliUrl, modelId, ...(r.id === 'opencode' ? { canonical: 'opencode' } : {}), ...(providerId === 'corpgate-test' ? { apiKey: 'local-test-only' } : {}) }), null, 2)
        : (r.id === 'anthropic' ? '$env:ANTHROPIC_BASE_URL="' + cliUrl + '"; claude' : '$env:OPENAI_BASE_URL="' + cliUrl + '"');
      const proxyMode: ProxyMode = r.proxy_mode === 'system' || r.proxy_mode === 'custom' ? r.proxy_mode : 'direct';
      return { id: r.id, name: r.name, prefix: r.prefix, suffix, cliUrl, upstreamUrl: r.upstream_url, commandExample, description: r.description, isCustom: Boolean(r.is_custom), isUnusedPreset: new RouteAvailability(this.db, this.hasHistory).isUnusedPreset(r), proxyMode, httpProxy: r.http_proxy || '', httpsProxy: r.https_proxy || '', noProxy: r.no_proxy || '' };
    });

  public getSettings = () => {
    const routes = this.db.getAllRoutes();
    const find = (id: string): string => routes.find(r => r.id === id)?.upstream_url || '';
    return { opencode: find('opencode'), go: find('opencode-go'), anthropic: find('anthropic'), openai: find('openai'), ollama: find('ollama'), chatBase: find('opencode'), anthropicBase: find('anthropic'), routes };
  };

  public updateSettings = (settings: Record<string, string | undefined>) => {
    const aliases: Record<string, string> = { chatBase: 'opencode', anthropicBase: 'anthropic', go: 'opencode-go' };
    const changes = Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => [aliases[key] || key, RouteRegistry.validateUrl(value || '')]);
    for (const [id, url] of changes) {
      if (this.db.getAllRoutes().some(r => r.id === id)) this.updateRoute(id, url);
    }
    return this.getSettings();
  };

  public static validateSuffix = (value: string): string => {
    const suffix = value.trim();
    if (!/^(?:\/[a-zA-Z0-9._~-]+)*\/?$/.test(suffix) || suffix.split('/').some(part => part === '.' || part === '..')) throw new Error('Specify a path such as /v1 or /api/v2, or leave empty');
    return suffix.replace(/\/$/, '');
  };

  public createCustomRoute = (data: { name: string; prefix: string; upstreamUrl: string; description?: string; suffix?: string } & RouteProxyConfig, baseUrl: string = this.hostPort): RouteDefinition => {
    const suffix = RouteRegistry.validateSuffix(data.suffix ?? '');
    const prefix = data.prefix.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9-]+$/.test(prefix) || ['api', 'health', 'dashboard', 'zen'].includes(prefix)) throw new Error('Invalid route prefix');
    const existing = this.db.getAllRoutes().find(r => r.prefix === prefix);
    if (existing && !new RouteAvailability(this.db, this.hasHistory).isUnusedPreset(existing)) throw new Error('This prefix is already in use');
    const upstreamUrl = RouteRegistry.validateUrl(data.upstreamUrl);
    const name = data.name.trim();
    if (!name) throw new Error('Specify a route name');
    const proxy = RouteRegistry.validateProxy(data);
    const id = existing?.id || 'custom-' + prefix;
    this.db.upsertRoute({ id, name, prefix, upstream_url: upstreamUrl, description: data.description?.trim() || name, is_custom: 1, proxy_mode: proxy.proxyMode ?? 'direct', http_proxy: proxy.httpProxy ?? '', https_proxy: proxy.httpsProxy ?? '', no_proxy: proxy.noProxy ?? '' });
    this.db.setSetting('route_suffix_' + id, suffix);
    return this.getRoutes(baseUrl).find(r => r.id === id)!;
  };

  public updateRoute = (id: string, upstreamUrl?: string, baseUrl: string = this.hostPort, name?: string, suffix?: string, proxy?: RouteProxyConfig): RouteDefinition | null => {
    const cleanSuffix = suffix === undefined ? undefined : RouteRegistry.validateSuffix(suffix);
    const canonicalId = id === 'claude' ? 'anthropic' : id;
    const existing = this.db.getAllRoutes().find(r => r.id === canonicalId);
    if (!existing) return null;
    const cleanUrl = upstreamUrl !== undefined ? RouteRegistry.validateUrl(upstreamUrl) : existing.upstream_url;
    if (name !== undefined && !name.trim()) throw new Error('Specify a connection name');
    const cleanProxy = proxy ? RouteRegistry.validateProxy(proxy) : {};
    this.db.upsertRoute({
      ...existing,
      upstream_url: cleanUrl,
      name: name?.trim() || existing.name,
      proxy_mode: cleanProxy.proxyMode ?? existing.proxy_mode ?? 'direct',
      http_proxy: cleanProxy.httpProxy ?? existing.http_proxy ?? '',
      https_proxy: cleanProxy.httpsProxy ?? existing.https_proxy ?? '',
      no_proxy: cleanProxy.noProxy ?? existing.no_proxy ?? '',
    });
    if (cleanSuffix !== undefined) this.db.setSetting('route_suffix_' + canonicalId, cleanSuffix);
    this.db.setSetting('upstream_' + canonicalId, cleanUrl);
    if (canonicalId === 'opencode') this.db.setSetting('upstream_chat_base', cleanUrl);
    if (canonicalId === 'anthropic') this.db.setSetting('upstream_anthropic_base', cleanUrl);
    return this.getRoutes(baseUrl).find(r => r.id === canonicalId) || null;
  };

  public deleteRoute = (id: string): boolean => this.db.deleteRoute(id === 'claude' ? 'anthropic' : id);
}
