import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { ProxyMode } from '../vault/database-types.js';

export interface RouteProxyConfig {
  proxyMode?: ProxyMode;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

interface UpstreamRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  proxy?: RouteProxyConfig;
}

export class UpstreamClient {
  private agents = new Map<string, ProxyAgent>();

  constructor(private send: typeof fetch = fetch) {}

  public static matchesNoProxy = (targetUrl: string, noProxy: string): boolean => {
    if (!noProxy.trim()) return false;
    let target: URL;
    try { target = new URL(targetUrl); } catch { return false; }
    const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const port = target.port || (target.protocol === 'https:' ? '443' : '80');
    for (const raw of noProxy.split(',')) {
      const entry = raw.trim().toLowerCase();
      if (!entry) continue;
      if (entry === '*') return true;
      let entryHost = entry;
      let entryPort = '';
      if (entry.startsWith('[')) {
        const end = entry.indexOf(']');
        if (end < 0) continue;
        entryHost = entry.slice(1, end);
        if (entry[end + 1] === ':') entryPort = entry.slice(end + 2);
      } else {
        const colon = entry.lastIndexOf(':');
        if (colon > -1 && !entry.slice(0, colon).includes(':')) {
          entryHost = entry.slice(0, colon);
          entryPort = entry.slice(colon + 1);
        }
      }
      if (entryPort && entryPort !== port) continue;
      if (entryHost.startsWith('*.')) entryHost = entryHost.slice(1);
      if (entryHost.startsWith('.')) {
        const bare = entryHost.slice(1);
        if (bare && (host === bare || host.endsWith(entryHost))) return true;
      } else if (host === entryHost || host.endsWith('.' + entryHost)) return true;
    }
    return false;
  };

  private resolveProxyUrl = (targetUrl: string, proxy?: RouteProxyConfig): string | undefined => {
    const mode = proxy?.proxyMode ?? 'direct';
    if (mode === 'direct') return undefined;
    let target: URL;
    try { target = new URL(targetUrl); } catch { return undefined; }
    const httpProxy = (mode === 'system' ? proxy?.httpProxy?.trim() || process.env.HTTP_PROXY || process.env.http_proxy : proxy?.httpProxy?.trim()) || '';
    const httpsProxy = (mode === 'system' ? proxy?.httpsProxy?.trim() || process.env.HTTPS_PROXY || process.env.https_proxy : proxy?.httpsProxy?.trim()) || '';
    const noProxy = (mode === 'system' ? (proxy?.noProxy?.trim() ? proxy.noProxy : (process.env.NO_PROXY || process.env.no_proxy)) : proxy?.noProxy?.trim()) || '';
    if (UpstreamClient.matchesNoProxy(targetUrl, noProxy)) return undefined;
    const selected = target.protocol === 'https:' ? (httpsProxy || httpProxy) : httpProxy;
    return selected || undefined;
  };

  private getAgent = (proxyUrl: string): ProxyAgent => {
    let agent = this.agents.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      this.agents.set(proxyUrl, agent);
    }
    return agent;
  };

  public close = async (): Promise<void> => {
    const list = [...this.agents.values()];
    this.agents.clear();
    await Promise.allSettled(list.map(agent => agent.close()));
  };

  public fetch = (target: string, request: UpstreamRequest): Promise<Response> => {
    const headers = new Headers(request.headers);
    const relay = headers.get('x-corpgate-native-relay');
    const token = headers.get('x-corpgate-native-token');
    const chunked = headers.get('transfer-encoding')?.split(',').some(name => name.trim().toLowerCase() === 'chunked');
    const connectionHeaders = headers.get('connection')?.split(',').map(name => name.trim()).filter(Boolean) ?? [];
    const transportHeaders = ['host', 'content-length', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
    for (const name of [...connectionHeaders, ...transportHeaders, 'x-corpgate-native-relay', 'x-corpgate-native-token', 'x-corpgate-native-target']) headers.delete(name);
    const { proxy, ...rest } = request;
    const init: RequestInit & { duplex?: 'half' } = { ...rest, headers };
    if (chunked && rest.body !== undefined) {
      init.body = new Blob([rest.body]).stream();
      init.duplex = 'half';
    }
    if (relay && token && /^https:\/\/opencode\.ai\/(?:inference|zen)\/(?!go(?:\/|$))/.test(target)) {
      let endpoint: URL;
      try { endpoint = new URL(relay); }
      catch { throw new Error('Invalid native transport endpoint'); }
      if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.pathname !== '/relay' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid native transport endpoint');
      headers.set('x-corpgate-native-token', token);
      headers.set('x-corpgate-native-target', target);
      return this.send(endpoint, init);
    }
    const proxyUrl = this.resolveProxyUrl(target, proxy);
    if (!proxyUrl) return this.send(target, init);
    const dispatcher = this.getAgent(proxyUrl);
    if (this.send === fetch) return undiciFetch(target, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher }) as unknown as Promise<Response>;
    return this.send(target, { ...init, dispatcher } as unknown as RequestInit);
  };
}
