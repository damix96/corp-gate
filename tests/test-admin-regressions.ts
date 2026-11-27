import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { RouteRegistry } from '../src/proxy/route-registry.js';
import { SecretProtection } from '../src/security/secret-protection.js';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';
import { TransactionRecord } from '../src/telemetry/types.js';

class AdminRegressionTests {
  private protection = new SecretProtection({ name: 'test-memory', encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value) });
  private db = new VaultDatabase(':memory:', this.protection);
  private vault = new VaultStore(this.db);
  private upstream = Fastify();
  private proxy = new CorpGateProxyServer(this.vault, { port: 0 });
  private releaseLate?: () => void;
  private lateStarted?: () => void;
  private observedHostOrigin: { host?: string; origin?: string } = {};

  private transaction = (id: string, sessionId: string, text: string): TransactionRecord => ({
    id,
    sessionId,
    targetProvider: 'OpenCode',
    targetUrl: 'http://127.0.0.1/mock/v1/chat/completions',
    request: { method: 'POST', url: '/mock/v1/chat/completions', headers: {}, body: { messages: [{ role: 'user', content: text }] }, client: 'OpenCode' },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] }, isStream: false, client: 'OpenCode' },
    interceptedSecrets: [],
    timestamp: new Date().toISOString(),
    maskedPrompt: text,
  });

  private requestWithHost = (base: string, origin?: string): Promise<number> => new Promise((resolve, reject) => {
    const address = new URL(base);
    const request = httpRequest({ hostname: address.hostname, port: Number(address.port), path: '/api/vault', headers: { host: 'audit.invalid', ...(origin ? { origin } : {}) } }, response => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.on('error', reject);
    request.end();
  });

  private foreignOriginGuard = async (base: string): Promise<void> => {
    const foreign = { origin: 'https://audit.invalid' };
    const sameOrigin = new URL(base).origin;
    const token = this.proxy.getAdminToken();
    const bearer = { authorization: 'Bearer ' + token };
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/vault', { headers: { origin: sameOrigin } })).status, 401);
    assert.equal((await fetch(base + '/api/vault')).status, 401);
    assert.equal((await fetch(base + '/api/vault', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base + '/api/vault', { headers: bearer })).status, 200);
    assert.equal((await fetch(base + '/api/vault', { headers: { origin: 'null' } })).status, 403);
    assert.equal((await fetch(base + '/api/vault', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/history', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/sessions', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/hooks/context', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/export', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/workspace', { headers: foreign })).status, 403);
    const spoofedHost = await this.requestWithHost(base, sameOrigin);
    const injectedSpoof = await (this.proxy as any).app.inject({ url: '/api/vault', headers: { origin: sameOrigin, host: 'audit.invalid' } });
    assert.equal(spoofedHost, 403, JSON.stringify({ observed: this.observedHostOrigin, injectStatus: injectedSpoof.statusCode }));
    assert.equal(injectedSpoof.statusCode, 403);
    assert.equal(await this.requestWithHost(base), 403);
    const before = this.vault.getManualSecrets().length;
    const mutation = await fetch(base + '/api/vault/secret', { method: 'POST', headers: { ...foreign, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'FOREIGN_ORIGIN', realValue: 'synthetic-blocked-value' }) });
    assert.equal(mutation.status, 403);
    assert.equal(this.vault.getManualSecrets().length, before);
    const options = await fetch(base + '/api/vault/secret', { method: 'OPTIONS', headers: { ...foreign, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(options.status, 403);
    const eventsOptions = await fetch(base + '/api/events', { method: 'OPTIONS', headers: { ...foreign, 'access-control-request-method': 'GET' } });
    assert.equal(eventsOptions.status, 403);
    const eventsAbort = new AbortController();
    const events = await fetch(base + '/api/events', { headers: foreign, signal: eventsAbort.signal });
    const eventsStatus = events.status;
    eventsAbort.abort();
    assert.equal(eventsStatus, 403);
    (globalThis as any).__corpgateForeignHookRan = 0;
    try {
      const hook = await fetch(base + '/api/hooks/test-run', { method: 'POST', headers: { ...foreign, 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'beforeOutboundRequest', hookCode: '() => { globalThis.__corpgateForeignHookRan = 1; return { safe: true }; }' }) });
      assert.equal(hook.status, 403);
      assert.equal((globalThis as any).__corpgateForeignHookRan, 0);
      const removedHook = await fetch(base + '/api/hooks/test-run', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(removedHook.status, 404);
    } finally { delete (globalThis as any).__corpgateForeignHookRan; }

    assert.equal((await fetch(base + '/api/interface/vault', { method: 'POST', headers: { origin: sameOrigin, 'x-corpgate-display': 'original', 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(base + '/api/vault/secret', { method: 'POST', headers: { origin: sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'NO_COOKIE', realValue: 'blocked' }) })).status, 401);
    const plainDash = await fetch(base + '/dashboard');
    assert.equal(plainDash.status, 200);
    assert.equal(plainDash.headers.get('set-cookie'), null);
    const plainRoot = await fetch(base + '/');
    assert.equal(plainRoot.status, 200);
    assert.equal(plainRoot.headers.get('set-cookie'), null);
    const badQueryLogin = await fetch(base + '/?token=wrong', { redirect: 'manual' });
    assert.equal(badQueryLogin.status, 401);
    assert.equal(badQueryLogin.headers.get('set-cookie'), null);
    const dashRes = await fetch(base + '/dashboard?token=' + token, { redirect: 'manual' });
    assert.equal(dashRes.status, 302);
    assert.equal(dashRes.headers.get('location'), '/dashboard');
    const setCookie = dashRes.headers.get('set-cookie') || '';
    assert.match(setCookie, /cg_session=[^;]+/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Max-Age=2592000/i);
    const rootLogin = await fetch(base + '/?token=' + token, { redirect: 'manual' });
    assert.equal(rootLogin.status, 302);
    assert.equal(rootLogin.headers.get('location'), '/');
    assert.equal((await fetch(base + '/api/auth/session', { method: 'POST', headers: { origin: sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })).status, 401);
    const postAuth = await fetch(base + '/api/auth/session', { method: 'POST', headers: { origin: sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(postAuth.status, 200);
    assert.match(postAuth.headers.get('set-cookie') || '', /cg_session=[^;]+/);
    const cookie = setCookie.split(';')[0];
    this.vault.setManualSecret('COOKIE_SECRET', 'synthetic-cookie-secret', undefined, true);
    const revealed = await fetch(base + '/api/interface/vault', { method: 'POST', headers: { origin: sameOrigin, cookie, 'x-corpgate-display': 'original', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(revealed.status, 200);
    assert.equal(((await revealed.json()) as any).manual.find((row: any) => row.key === 'COOKIE_SECRET').realValue, 'synthetic-cookie-secret');
    this.vault.deleteSecret('COOKIE_SECRET');
    const exportedText = await (await fetch(base + '/api/export', { headers: bearer })).text();
    assert.equal(exportedText.includes(token), false);
    assert.equal(exportedText.includes('adminToken'), false);
    const explicitProxy = new CorpGateProxyServer(this.vault, { port: 0, adminToken: 'explicit-export-admin-token' });
    try {
      const explicitExport = await explicitProxy.getApp().inject({ url: '/api/export', headers: { authorization: 'Bearer explicit-export-admin-token' } });
      assert.equal(explicitExport.statusCode, 200);
      assert.equal(explicitExport.body.includes('explicit-export-admin-token'), false);
      assert.equal(explicitExport.body.includes('adminToken'), false);
      assert.equal(Object.hasOwn(explicitExport.json().data.proxy[0], 'adminToken'), false);
    } finally { await explicitProxy.close(); }
  };

  private cliHeadersAndSessionDeletion = async (base: string): Promise<void> => {
    const bearer = { authorization: 'Bearer ' + this.proxy.getAdminToken() };
    const modelResponse = await fetch(base + '/admin-local/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-cli-auth', 'x-preserved-header': 'preserved-cli-header', 'x-session-id': 'session-cli' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'no Origin CLI request' }] }) });
    assert.equal(modelResponse.status, 200);
    assert.equal((await modelResponse.json() as any).choices[0].message.content, 'model-ok');
    assert.equal(this.upstreamReceived.authorization, 'Bearer synthetic-cli-auth');
    assert.equal(this.upstreamReceived['x-preserved-header'], 'preserved-cli-header');

    this.vault.setManualSecret('ADMIN_RULE_KEEP', 'synthetic-rule-value');
    this.vault.setManualSecret('ADMIN_DELETE_CLIENT', 'synthetic-delete-client-value');
    const deletedSecret = await fetch(base + '/api/vault/secret/ADMIN_DELETE_CLIENT', { method: 'DELETE', headers: bearer });
    assert.deepEqual(await deletedSecret.json(), { success: true });
    assert.equal(((await (await fetch(base + '/api/vault', { headers: bearer })).json()) as { manual: Array<{ key: string }> }).manual.some(secret => secret.key === 'ADMIN_DELETE_CLIENT'), false);
    this.proxy.recordTransaction(this.transaction('tx-session-a', 'session-a', 'a'));
    this.proxy.recordTransaction(this.transaction('tx-session-b', 'session-b', 'b'));
    const deleted = await fetch(base + '/api/sessions/session-b', { method: 'DELETE', headers: bearer });
    assert.equal(deleted.status, 200);
    const history = await (await fetch(base + '/api/history', { headers: bearer })).json() as any[];
    assert.equal(history.some(transaction => transaction.id === 'tx-session-b'), false);
    assert.equal(history.some(transaction => transaction.id === 'tx-session-a'), true);
    assert.equal((await (await fetch(base + '/api/sessions/session-b', { headers: bearer })).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/sessions/session-b/full', { headers: bearer })).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/sessions/session-a', { headers: bearer })).json() as any[]).length, 1);
    assert.equal((await (await fetch(base + '/api/hooks/context?id=tx-session-b', { headers: bearer })).json() as any).empty, true);
    assert.equal((await (await fetch(base + '/api/hooks/context', { headers: bearer })).json() as any).id, 'tx-session-a');
    const sessions = await (await fetch(base + '/api/sessions', { headers: bearer })).json() as any[];
    assert.deepEqual(sessions.map(session => session.id).sort(), ['session-a', 'session-cli']);
    assert.equal(this.vault.getManualSecrets().some(secret => secret.key === 'ADMIN_RULE_KEEP'), true);
    await this.verifyLateTransactionDeletion(base);
    const clear = await fetch(base + '/api/sessions', { method: 'DELETE', headers: bearer });
    assert.deepEqual(await clear.json(), { success: true, count: 0 });
    assert.equal((await (await fetch(base + '/api/sessions', { headers: bearer })).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/history', { headers: bearer })).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/hooks/context', { headers: bearer })).json() as any).empty, true);
    assert.equal(this.vault.getManualSecrets().some(secret => secret.key === 'ADMIN_RULE_KEEP'), true);
  };

  private upstreamReceived: Record<string, string> = {};

  private verifyLateTransactionDeletion = async (base: string): Promise<void> => {
    const bearer = { authorization: 'Bearer ' + this.proxy.getAdminToken() };
    const started = new Promise<void>(resolve => { this.lateStarted = resolve; });
    const responsePromise = fetch(base + '/admin-local/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'session-late' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'inflight local request' }] }) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([started, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Late transaction request did not reach upstream')), 5000); })]);
    if (timer) clearTimeout(timer);
    assert.equal((await fetch(base + '/api/sessions/session-late', { method: 'DELETE', headers: bearer })).status, 200);
    this.releaseLate?.();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal((await (await fetch(base + '/api/sessions', { headers: bearer })).json() as any[]).some(session => session.id === 'session-late'), false);
    assert.equal((await (await fetch(base + '/api/history', { headers: bearer })).json() as any[]).some(transaction => transaction.session_id === 'session-late'), false);
    assert.equal(this.proxy.getTransactionHistory().some(transaction => transaction.sessionId === 'session-late'), false);
  };

  public run = async (): Promise<void> => {
    this.upstream.post('/v1/chat/completions', async (request, reply) => {
      this.upstreamReceived = { authorization: String(request.headers.authorization || ''), 'x-preserved-header': String(request.headers['x-preserved-header'] || '') };
      if (request.headers['x-session-id'] === 'session-late') {
        await new Promise<void>(resolve => { this.releaseLate = resolve; this.lateStarted?.(); });
      }
      return reply.send({ choices: [{ message: { role: 'assistant', content: 'model-ok' } }] });
    });
    (this.proxy as any).app.server.on('request', (request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
      if (request.url === '/api/vault') this.observedHostOrigin = { host: String(request.headers.host || ''), origin: String(request.headers.origin || '') };
    });
    const upstreamUrl = await this.upstream.listen({ port: 0, host: '127.0.0.1' });
    new RouteRegistry(this.db).createCustomRoute({ name: 'Admin regression mock', prefix: 'admin-local', upstreamUrl });
    const base = await this.proxy.listen();
    try {
      this.vault.setManualSecret('ADMIN_RULE_KEEP', 'synthetic-rule-value');
      await this.foreignOriginGuard(base);
      await this.cliHeadersAndSessionDeletion(base);
      console.log('Admin regressions passed: origin/host guard, CLI route headers, history/session cleanup, late transaction tombstone, and rule preservation.');
    } finally {
      await this.proxy.close();
      await this.upstream.close();
      this.db.close();
    }
  };
}

new AdminRegressionTests().run().catch(error => { console.error(error); process.exitCode = 1; });
