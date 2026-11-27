import { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

export interface RouteResolution {
  forwardPath: string;
  targetUrl: string;
  targetProvider: string;
}

export interface UpstreamMap {
  opencode?: string;
  go?: string;
  anthropic?: string;
  openai?: string;
  ollama?: string;
  chatBase?: string;
  anthropicBase?: string;
}

export class SessionResolver {
  private clientSessions = new Map<string, { sessionId: string; lastSeen: number }>();

  public resolveSessionId = (req: FastifyRequest, clientName: string): string => {
    const h = req.headers;
    const headerVal = h['x-session-id'] || h['x-opencode-session'] || h['session-id'] || h['x-conversation-id'];
    if (headerVal) return Array.isArray(headerVal) ? String(headerVal[0]) : String(headerVal);
    const body: any = req.body;
    let messages: any[] | undefined = undefined;
    let systemPrompt = '';
    if (body && typeof body === 'object') {
      if (Array.isArray(body.messages)) messages = body.messages;
      if (typeof body.system === 'string') systemPrompt = body.system;
      else if (Array.isArray(body.system)) systemPrompt = JSON.stringify(body.system);
    } else if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed.messages)) messages = parsed.messages;
        if (typeof parsed.system === 'string') systemPrompt = parsed.system;
      } catch {}
    }
    if (messages && messages.length > 0) {
      const root = messages[0];
      const rootStr = typeof root === 'string' ? root : (typeof root.content === 'string' ? root.content : JSON.stringify(root.content || root));
      const seed = clientName + '::' + (systemPrompt ? systemPrompt.slice(0, 100) + '::' : '') + rootStr.slice(0, 200);
      return 'sess_' + createHash('sha256').update(seed).digest('hex').slice(0, 12);
    }
    const clientKey = clientName + '::' + (req.ip || '127.0.0.1');
    const now = Date.now();
    const existing = this.clientSessions.get(clientKey);
    if (existing && (now - existing.lastSeen) < 15 * 60 * 1000) {
      existing.lastSeen = now;
      return existing.sessionId;
    }
    const newSessionId = 'sess_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    this.clientSessions.set(clientKey, { sessionId: newSessionId, lastSeen: now });
    return newSessionId;
  };

  public resolveProvider = (url: string, base: string, targetUrl: string): string => {
    if (base.toLowerCase().includes('ollama') || targetUrl.toLowerCase().includes('ollama')) return 'Ollama';
    if (base.toLowerCase().includes('openai') || targetUrl.toLowerCase().includes('openai')) return 'OpenAI';
    if (url.includes('chat') || base.toLowerCase().includes('opencode')) return 'OpenCode';
    if (base.toLowerCase().includes('anthropic') || targetUrl.toLowerCase().includes('anthropic')) return 'Anthropic';
    try { return new URL(targetUrl).hostname; } catch { return 'Custom'; }
  };

  private stripPrefix = (rawUrl: string, prefix: string): string => {
    const stripped = rawUrl.slice(prefix.length + 1);
    return !stripped ? '/' : (stripped.startsWith('?') ? '/' + stripped : stripped);
  };

  public resolveRoute = (rawUrl: string, upstreamsOrChatBase: UpstreamMap | string, anthropicBaseFallback?: string, customBase?: string): RouteResolution => {
    const isObj = typeof upstreamsOrChatBase === 'object' && upstreamsOrChatBase !== null;
    const opencode = isObj ? (upstreamsOrChatBase.opencode || upstreamsOrChatBase.chatBase || '') : (upstreamsOrChatBase || '');
    const go = isObj ? (upstreamsOrChatBase.go || '') : '';
    const anthropic = isObj ? (upstreamsOrChatBase.anthropic || upstreamsOrChatBase.anthropicBase || '') : (anthropicBaseFallback || '');
    const openai = isObj ? (upstreamsOrChatBase.openai || '') : '';
    const ollama = isObj ? (upstreamsOrChatBase.ollama || '') : '';
    const pathname = rawUrl.split('?')[0];
    const dynamicRoutes = isObj ? (((upstreamsOrChatBase as any).routes || (upstreamsOrChatBase as any).customRoutes || []) as any[]) : [];

    let forwardPath = '';
    let base = '';
    let provider = '';
    const match = (prefix: string): boolean => pathname === '/' + prefix || pathname.startsWith('/' + prefix + '/');

    for (const r of dynamicRoutes) {
      if (r.prefix && match(r.prefix) && (r.upstream_url || r.upstreamUrl)) {
        forwardPath = this.stripPrefix(rawUrl, r.prefix);
        base = r.upstream_url || r.upstreamUrl;
        provider = r.id === 'opencode' ? 'OpenCode' : (r.id === 'opencode-go' ? 'OpenCode Go' : (r.name || this.resolveProvider(forwardPath, base, base + forwardPath)));
        break;
      }
    }

    if (!base) {
      const staticMap: Array<[string, string, string]> = [
        ['opencode-go', go, 'OpenCode Go'],
        ['anthropic', anthropic, 'Anthropic'],
        ['opencode', opencode, 'OpenCode'],
        ['zen', opencode, 'OpenCode'],
        ['openai', openai, 'OpenAI'],
        ['ollama', ollama, 'Ollama'],
      ];
      for (const [prefix, target, label] of staticMap) {
        if (target && match(prefix)) {
          forwardPath = this.stripPrefix(rawUrl, prefix);
          base = target;
          provider = label;
          break;
        }
      }
    }

    if (!base) throw Object.assign(new Error('Route not configured in CorpGate'), { statusCode: 404 });

    const effectiveBase = (process.env.TARGET_API_BASE || (customBase && customBase !== 'https://api.anthropic.com' ? customBase : base)).replace(/\/+$/, '');
    if (/^https:\/\/opencode\.ai\/(?:inference|zen)(?:\/go)?$/.test(effectiveBase)) {
      const gemini = /^\/v\d+(?:beta)?\/models\/[^/?]+:[^/?]+(?:\?|$)/.test(forwardPath);
      const family = gemini ? '/google' : /\/messages(?:\?|$)/.test(forwardPath) ? '/anthropic' : '/openai';
      forwardPath = family + forwardPath;
    }
    const targetUrl = effectiveBase + (effectiveBase.endsWith('/v1') ? forwardPath.replace(/^\/v1(?=\/|$)/, '') : forwardPath);
    return { forwardPath, targetUrl, targetProvider: provider };
  };
}
