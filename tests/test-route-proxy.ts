import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { UpstreamClient } from '../src/proxy/upstream-client.js';

class RouteProxyTests {
  private dir = mkdtempSync(join(tmpdir(), 'corpgate-proxy-'));

  private testNoProxyMatching = (): void => {
    assert.equal(UpstreamClient.matchesNoProxy('https://api.openai.com/v1', ''), false);
    assert.equal(UpstreamClient.matchesNoProxy('https://api.openai.com/v1', '*'), true);
    assert.equal(UpstreamClient.matchesNoProxy('http://localhost:11434/api', 'localhost'), true);
    assert.equal(UpstreamClient.matchesNoProxy('http://evil-localhost.com/api', 'localhost'), false);
    assert.equal(UpstreamClient.matchesNoProxy('https://llm.corp.local/v1', '.corp.local'), true);
    assert.equal(UpstreamClient.matchesNoProxy('https://corp.local/v1', '.corp.local'), true);
    assert.equal(UpstreamClient.matchesNoProxy('https://evilcorp.local/v1', '.corp.local'), false);
    assert.equal(UpstreamClient.matchesNoProxy('https://api.corp.local:8443/v1', 'api.corp.local:8443'), true);
    assert.equal(UpstreamClient.matchesNoProxy('https://api.corp.local:9443/v1', 'api.corp.local:8443'), false);
    assert.equal(UpstreamClient.matchesNoProxy('http://127.0.0.1:8080/v1', '10.0.0.1, 127.0.0.1:8080'), true);
    assert.equal(UpstreamClient.matchesNoProxy('http://[::1]:9000/v1', '[::1]:9000'), true);
    assert.equal(UpstreamClient.matchesNoProxy('http://[::1]:9001/v1', '[::1]:9000'), false);
  };

  private testMigrationAndPersistence = async (): Promise<void> => {
    const file = join(this.dir, 'legacy-routes.db');
    const legacy = new DatabaseSync(file);
    legacy.exec('CREATE TABLE routes (id TEXT PRIMARY KEY, name TEXT, prefix TEXT UNIQUE, upstream_url TEXT, description TEXT, is_custom INTEGER DEFAULT 0);');
    legacy.prepare('INSERT INTO routes VALUES (?, ?, ?, ?, ?, 0)').run('openai', 'OpenAI', 'openai', 'https://api.openai.com', 'OpenAI');
    legacy.close();
    let db = new VaultDatabase(file);
    let server = new CorpGateProxyServer(new VaultStore(db), { port: 0 });
    const headers = { authorization: 'Bearer ' + server.getAdminToken(), 'content-type': 'application/json' };
    try {
      const initial = (await server.getApp().inject({ url: '/api/routes', headers: { authorization: headers.authorization } })).json();
      assert.equal(initial.find((r: any) => r.id === 'openai').proxyMode, 'direct');
      const bad = await server.getApp().inject({ method: 'PUT', url: '/api/routes/openai', headers, payload: { proxyMode: 'custom', httpProxy: 'ftp://proxy.invalid:21' } });
      assert.equal(bad.statusCode, 400);
      const badMode = await server.getApp().inject({ method: 'PUT', url: '/api/routes/openai', headers, payload: { proxyMode: 'socks' } });
      assert.equal(badMode.statusCode, 400);
      const updated = await server.getApp().inject({
        method: 'PUT', url: '/api/routes/openai', headers,
        payload: { proxyMode: 'custom', httpProxy: 'http://proxy.corp:8080', httpsProxy: 'https://proxy.corp:8443', noProxy: '.corp.local,127.0.0.1' },
      });
      assert.equal(updated.statusCode, 200);
      assert.equal(updated.json().proxyMode, 'custom');
      assert.equal(updated.json().httpProxy, 'http://proxy.corp:8080');
      assert.equal(updated.json().httpsProxy, 'https://proxy.corp:8443');
      assert.equal(updated.json().noProxy, '.corp.local,127.0.0.1');
    } finally { await server.close(); db.close(); }
    db = new VaultDatabase(file);
    server = new CorpGateProxyServer(new VaultStore(db), { port: 0 });
    try {
      const reloaded = (await server.getApp().inject({ url: '/api/routes', headers: { authorization: 'Bearer ' + server.getAdminToken() } })).json();
      const openai = reloaded.find((r: any) => r.id === 'openai');
      assert.equal(openai.proxyMode, 'custom');
      assert.equal(openai.httpProxy, 'http://proxy.corp:8080');
      assert.equal(openai.httpsProxy, 'https://proxy.corp:8443');
      assert.equal(openai.noProxy, '.corp.local,127.0.0.1');
    } finally { await server.close(); db.close(); }
  };

  private testSystemProxyAndRealRouting = async (): Promise<void> => {
    const savedEnv = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy, HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    let directHits = 0;
    const proxiedUrls: string[] = [];
    const upstream = createServer((req, res) => {
      directHits++;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'upstream-ok' } }] }));
      });
    });
    const proxyServer = createServer((req, res) => {
      proxiedUrls.push(req.url || '');
      const target = new URL(req.url!);
      const forwarded = httpRequest({ hostname: target.hostname, port: Number(target.port || 80), path: target.pathname + target.search, method: req.method, headers: req.headers }, upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      });
      forwarded.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(forwarded);
    });
    upstream.listen(0, '127.0.0.1');
    proxyServer.listen(0, '127.0.0.1');
    await Promise.all([once(upstream, 'listening'), once(proxyServer, 'listening')]);
    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxyPort = (proxyServer.address() as { port: number }).port;
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const server = new CorpGateProxyServer(vault, { host: '127.0.0.1', port: 0 });
    try {
      const base = await server.listen();
      const auth = { authorization: 'Bearer ' + server.getAdminToken(), 'content-type': 'application/json' };
      assert.equal((await fetch(base + '/api/system-proxy')).status, 401);
      delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY; delete process.env.NO_PROXY;
      process.env.http_proxy = `http://127.0.0.1:${proxyPort}`;
      process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
      process.env.no_proxy = 'localhost,.internal';
      const sysRes = await fetch(base + '/api/system-proxy', { headers: { authorization: auth.authorization } });
      assert.equal(sysRes.status, 200);
      assert.deepEqual(await sysRes.json(), { httpProxy: `http://127.0.0.1:${proxyPort}`, httpsProxy: `http://127.0.0.1:${proxyPort}`, noProxy: 'localhost,.internal' });

      const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
      const httpProxyUrl = `http://127.0.0.1:${proxyPort}`;
      const created = await fetch(base + '/api/routes', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: 'Proxy Test', prefix: 'px', upstreamUrl, proxyMode: 'direct' }),
      });
      assert.equal(created.status, 201);
      const callProxy = async () => {
        const res = await fetch(base + '/px/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
        assert.equal(res.status, 200);
        assert.equal((await res.json() as any).choices[0].message.content, 'upstream-ok');
      };

      await callProxy();
      assert.equal(directHits, 1);
      assert.equal(proxiedUrls.length, 0);

      assert.equal((await fetch(base + '/api/routes/custom-px', { method: 'POST', headers: auth, body: JSON.stringify({ upstreamUrl, proxyMode: 'custom', httpProxy: httpProxyUrl, noProxy: '' }) })).status, 200);
      await callProxy();
      assert.equal(directHits, 2);
      assert.equal(proxiedUrls.length, 1);
      assert.equal(proxiedUrls[0], `${upstreamUrl}/v1/chat/completions`);

      const agentMap = ((server as any).upstreamClient as any).agents as Map<string, unknown>;
      const firstAgent = agentMap.get(httpProxyUrl);
      assert.ok(firstAgent);
      await callProxy();
      assert.equal(agentMap.get(httpProxyUrl), firstAgent);
      assert.equal(agentMap.size, 1);
      assert.equal(proxiedUrls.length, 2);

      assert.equal((await fetch(base + '/api/routes/custom-px', { method: 'PUT', headers: auth, body: JSON.stringify({ proxyMode: 'custom', httpProxy: httpProxyUrl, noProxy: `127.0.0.1:${upstreamPort}` }) })).status, 200);
      await callProxy();
      assert.equal(directHits, 4);
      assert.equal(proxiedUrls.length, 2);

      assert.equal((await fetch(base + '/api/routes/custom-px', { method: 'PUT', headers: auth, body: JSON.stringify({ proxyMode: 'system', httpProxy: '', httpsProxy: '', noProxy: '' }) })).status, 200);
      await callProxy();
      assert.equal(directHits, 5);
      assert.equal(proxiedUrls.length, 3);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      await server.close();
      db.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await new Promise<void>(resolve => proxyServer.close(() => resolve()));
    }
  };

  public run = async (): Promise<void> => {
    try {
      this.testNoProxyMatching();
      await this.testMigrationAndPersistence();
      await this.testSystemProxyAndRealRouting();
      console.log('PASS route proxy: NO_PROXY matching, GET /api/system-proxy, SQLite migration/persistence, agent caching, direct/custom/system routing');
    } finally { rmSync(this.dir, { recursive: true, force: true }); }
  };
}

await new RouteProxyTests().run();
