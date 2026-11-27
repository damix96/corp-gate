import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SecretInputAccess } from './access.js';
import { SecretInputManager } from './manager.js';

export class SecretInputPages {
  constructor(private app: FastifyInstance, private manager?: SecretInputManager, private access = new SecretInputAccess()) {}

  public register = (): void => {
    for (const url of ['/vault/set', '/vault/set/:id']) this.app.get(url, { logLevel: 'silent', exposeHeadRoute: false }, this.show);
    for (const prefix of ['/vault-secret/new', '/vault-secret/update', '/vault/new', '/vault/update', '/vault/input', '/new', '/update', '/set', '/input']) {
      for (const url of [prefix, prefix + '/:id']) this.app.get(url, { logLevel: 'silent', exposeHeadRoute: false }, this.redirect);
    }
  };

  private admit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff');
    if (this.access.allowed(request)) return true;
    void reply.code(403).send({ error: 'Local input page access denied' });
    return false;
  };

  private show = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (!this.admit(request, reply)) return;
    const paramsId = (request.params as { id?: string }).id;
    const source = new URL(request.url, 'http://localhost');
    const queryId = source.searchParams.get('request') ?? source.searchParams.get('requestId');
    const targetId = paramsId || (queryId && /^[a-zA-Z0-9_-]{4,36}$/.test(queryId) ? queryId : undefined);
    if (targetId && this.manager) {
      try {
        const view = this.manager.status(targetId);
        if (view.state === 'awaiting_input') reply.header('set-cookie', this.access.issuePageGrant(view.requestId).cookie);
      } catch {}
    }
    return reply.sendFile('index.html', { cacheControl: false, etag: false, lastModified: false });
  };

  private redirect = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (!this.admit(request, reply)) return;
    const id = (request.params as { id?: string }).id;
    const source = new URL(request.url, 'http://localhost');
    const query = new URLSearchParams();
    const requestId = source.searchParams.get('request') ?? source.searchParams.get('requestId');
    const secrets = source.searchParams.get('secrets');
    if ((id && !/^[a-zA-Z0-9_-]{4,36}$/.test(id)) || (requestId && !/^[a-zA-Z0-9_-]{4,36}$/.test(requestId))) return reply.code(400).send({ error: 'Invalid input request identifier' });
    if (!id && requestId) query.set('request', requestId);
    if (secrets && /^[A-Z0-9_]+(?:,[A-Z0-9_]+)*$/.test(secrets)) query.set('secrets', secrets);
    const target = '/vault/set' + (id ? '/' + encodeURIComponent(id) : '') + (query.size ? '?' + query.toString() : '');
    return reply.code(302).header('location', target).send();
  };
}
