import { randomBytes, timingSafeEqual } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface SecretInputAuthHooks {
  hasIntakeGrant: (request: FastifyRequest) => boolean;
  hasPageGrant: (request: FastifyRequest) => boolean;
}

export class AdminAccess {
  private static cookieName = 'cg_session';
  private static maxAgeSeconds = 2592000;
  private sessionToken = randomBytes(32).toString('base64url');
  private adminToken: string;

  constructor(private host: string, adminToken?: string, private secretInput?: SecretInputAuthHooks) {
    this.adminToken = adminToken || randomBytes(32).toString('hex');
  }

  public getAdminToken = (): string => this.adminToken;

  public install = (app: FastifyInstance): void => {
    app.addHook('onRequest', async (request, reply) => {
      const parsed = this.parseUrl(request.url);
      const pathname = parsed.pathname;
      if (request.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
        const token = parsed.searchParams.get('token');
        if (token !== null) {
          if (!this.allowed(request)) {
            await reply.code(403).send({ error: 'Administrative API accepts requests from its own origin only' });
            return;
          }
          if (!this.matchesToken(token)) {
            await reply.code(401).send({ error: 'Invalid admin token' });
            return;
          }
          this.issueSession(reply);
          parsed.searchParams.delete('token');
          const location = pathname + (parsed.searchParams.size ? '?' + parsed.searchParams.toString() : '');
          await reply.code(302).header('location', location).send();
          return;
        }
      }
      if (pathname.startsWith('/api/')) {
        if (!this.allowed(request)) {
          await reply.code(403).send({ error: 'Administrative API accepts requests from its own origin only' });
          return;
        }
        const isSecretRequest =
          /^\/api\/secret-input\/requests\/[a-zA-Z0-9_-]{4,36}(?:\/(?:submit|cancel))?$/.test(pathname) &&
          ((request.method === 'GET' && !pathname.endsWith('/submit') && !pathname.endsWith('/cancel')) ||
            (request.method === 'POST' && (pathname.endsWith('/submit') || pathname.endsWith('/cancel'))));
        const isSecretInputAuthorized =
          (pathname === '/api/secret-input/session' && request.method === 'POST' && Boolean(this.secretInput?.hasPageGrant(request))) ||
          (pathname === '/api/secret-input/requests' && request.method === 'POST' && Boolean(this.secretInput?.hasIntakeGrant(request))) ||
          (isSecretRequest && Boolean(this.secretInput?.hasIntakeGrant(request)));
        const isPublic = pathname === '/api/health' || (pathname === '/api/auth/session' && request.method === 'POST') || isSecretInputAuthorized;
        if (!isPublic && !this.isAuthorized(request)) {
          await reply.code(401).send({ error: 'Admin token or active dashboard session required' });
          return;
        }
      }
    });
    app.post('/api/auth/session', async (request, reply) => {
      const raw = (request.body as { token?: unknown } | undefined)?.token;
      const token = typeof raw === 'string' ? raw.trim() : '';
      if (!this.matchesToken(token)) return reply.code(401).send({ error: 'Invalid admin token' });
      this.issueSession(reply);
      return { authenticated: true };
    });
  };

  public isAuthorized = (request: FastifyRequest): boolean => this.hasSession(request) || this.hasBearerToken(request);

  public hasBearerToken = (request: FastifyRequest): boolean => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return false;
    return this.matchesToken(auth.slice(7).trim());
  };

  public hasSession = (request: FastifyRequest): boolean => {
    const header = request.headers.cookie;
    if (!header) return false;
    const expected = Buffer.from(this.sessionToken);
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      if (part.slice(0, index).trim() !== AdminAccess.cookieName) continue;
      const actual = Buffer.from(part.slice(index + 1).trim());
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
    }
    return false;
  };

  private matchesToken = (candidate: string): boolean => {
    if (!candidate) return false;
    const expected = Buffer.from(this.adminToken);
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  private issueSession = (reply: FastifyReply): void => {
    reply.header('set-cookie', `${AdminAccess.cookieName}=${this.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${AdminAccess.maxAgeSeconds}`);
  };

  private parseUrl = (rawUrl: string): URL => {
    try { return new URL(rawUrl, 'http://localhost'); }
    catch { return new URL('http://localhost/'); }
  };

  public cors = (request: FastifyRequest, callback: (error: null, options: { origin: boolean | string }) => void): void => {
    const pathname = request.url.split('?')[0];
    const origin = !pathname.startsWith('/mcp') && this.allowed(request) && request.headers.origin ? request.headers.origin : false;
    callback(null, { origin });
  };

  private allowed = (request: FastifyRequest): boolean => {
    try {
      const address = new URL(request.protocol + '://' + request.headers.host);
      const localAddress = request.raw.socket.localAddress?.replace(/^::ffff:/, '');
      const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', this.host, localAddress]);
      if (!allowedHosts.has(address.hostname) || address.username || address.password || address.pathname !== '/' || address.search || address.hash) return false;
      const port = Number(address.port || (address.protocol === 'https:' ? 443 : 80));
      if (request.raw.socket.localPort && port !== request.raw.socket.localPort) return false;
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return false;
      const origin = request.headers.origin;
      if (!origin) return true;
      const source = new URL(origin);
      return origin === source.origin && source.origin === address.origin;
    } catch { return false; }
  };
}
