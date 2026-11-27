import Fastify, { FastifyInstance } from 'fastify';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { VaultStore } from '../src/vault/store.js';
import { HookManager } from '../src/hooks/manager.js';

export class TelemetryTestRunner {
  private mockPort = 8793;
  private proxyPort = 8792;
  private mockApp: FastifyInstance = Fastify({ logger: false });
  private vault = new VaultStore();
  private hookManager = new HookManager();
  private proxyServer: CorpGateProxyServer;

  constructor() {
    this.proxyServer = new CorpGateProxyServer(
      this.vault,
      { port: this.proxyPort, targetApiBase: 'http://127.0.0.1:' + this.mockPort },
      this.hookManager
    );
  }

  private setupMock = (): void => {
    this.mockApp.post('/v1/chat/completions', async (req, reply) => {
      const body = req.body as any;
      return reply.send({ id: 'cmpl-123', choices: [{ message: { content: 'Echo ' + body.messages[0].content } }] });
    });
  };

  public run = async (): Promise<void> => {
    this.setupMock();
    await this.mockApp.listen({ port: this.mockPort, host: '127.0.0.1' });
    await this.proxyServer.listen();

    const baseUrl = 'http://127.0.0.1:' + this.proxyPort;
    const authHeaders = { authorization: 'Bearer ' + this.proxyServer.getAdminToken() };

    const initialCtxRes = await fetch(baseUrl + '/api/hooks/context', { headers: authHeaders });
    const initialCtxJson = (await initialCtxRes.json()) as any;
    if (!initialCtxJson.empty) throw new Error('Expected empty context before requests');

    this.vault.setManualSecret('TELEMETRY_KEY', 'telemetry_secret_val_999');

    const abortCtrl = new AbortController();
    const sseResPromise = fetch(baseUrl + '/api/events', { headers: authHeaders, signal: abortCtrl.signal }).catch(() => null);

    const triggerRes = await fetch(baseUrl + '/opencode/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Ping telemetry_secret_val_999' }] }),
    });
    if (!triggerRes.ok) throw new Error('Trigger request failed');

    const contextRes = await fetch(baseUrl + '/api/hooks/context', { headers: authHeaders });
    const contextJson = (await contextRes.json()) as any;
    if (!contextJson.request || !contextJson.response || contextJson.interceptedSecrets.length === 0) {
      throw new Error('lastTransactionContext verification failed: ' + JSON.stringify(contextJson));
    }
    if (contextJson.interceptedSecrets[0].key !== 'TELEMETRY_KEY') {
      throw new Error('Intercepted secret key mismatch');
    }

    const historyRes = await fetch(baseUrl + '/api/history', { headers: authHeaders });
    const historyJson = (await historyRes.json()) as any[];
    if (!Array.isArray(historyJson) || historyJson.length === 0 || !historyJson[0].id) {
      throw new Error('GET /api/history verification failed: ' + JSON.stringify(historyJson));
    }

    const firstTxId = historyJson[0].id;
    const contextByIdRes = await fetch(baseUrl + '/api/hooks/context?id=' + firstTxId, { headers: authHeaders });
    const contextByIdJson = (await contextByIdRes.json()) as any;
    if (contextByIdJson.id !== firstTxId) {
      throw new Error('GET /api/hooks/context?id= mismatch: ' + JSON.stringify(contextByIdJson));
    }

    const notFoundRes = await fetch(baseUrl + '/api/hooks/context?id=non_existent_tx', { headers: authHeaders });
    const notFoundJson = (await notFoundRes.json()) as any;
    if (!notFoundJson.empty) {
      throw new Error('Expected empty true for unknown tx id: ' + JSON.stringify(notFoundJson));
    }

    const pingRes = await fetch(baseUrl + '/api/test-ping', { method: 'POST', headers: authHeaders });
    const pingJson = (await pingRes.json()) as any;
    if (!pingJson.success || !pingJson.transaction?.id) {
      throw new Error('POST /api/test-ping failed: ' + JSON.stringify(pingJson));
    }

    const removedTestRun = await fetch(baseUrl + '/api/hooks/test-run', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'beforeOutboundRequest', hookCode: 'ctx => ctx' }),
    });
    if (removedTestRun.status !== 404) {
      throw new Error('Expected POST /api/hooks/test-run to be removed (404), got ' + removedTestRun.status);
    }

    abortCtrl.abort();
    await this.proxyServer.close();
    await this.mockApp.close();
    console.log('All telemetry and hook sandbox tests passed successfully!');
  };
}

new TelemetryTestRunner().run();
