import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RuntimeSettings } from '../../src/runtime/settings.js';
import { RuntimeApplication } from '../../src/runtime/application.js';
import { RuntimeDiagnostics } from '../../src/runtime/diagnostics.js';
import { RuntimeProbe } from '../../src/runtime/probe.js';
import { RuntimeCredentials } from '../../src/runtime/credentials.js';

class DiagnosticsTests {
  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpgate-diagnostics-'));
    const socket = createServer();
    await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: path.join(root, 'data'), port });
    const runtime = RuntimeApplication.create(settings);
    let fail = false;
    let authenticated = false;
    let leakedCanary = false;
    const credential = 'synthetic-provider-credential';
    const upstream = createServer(async (request, response) => {
      let text = '';
      for await (const chunk of request) text += chunk;
      authenticated = request.headers.authorization === 'Bearer ' + credential;
      leakedCanary ||= text.includes('corpgate-probe-');
      const alias = text.match(/\$\$\{<CG_PROBE_[A-Z0-9_]+>\}/)?.[0] || 'missing';
      response.setHeader('content-type', 'application/json');
      if (fail) { response.statusCode = 403; response.end(JSON.stringify({ error: credential })); return; }
      response.end(JSON.stringify(request.url?.endsWith('/messages') ? { content: [{ type: 'text', text: alias }] } : { choices: [{ message: { content: alias } }] }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    try {
      const stopped = await new RuntimeDiagnostics(settings).doctor();
      assert.equal(stopped.ok, false);
      assert.equal(existsSync(settings.dataDir), false, 'Doctor must not start runtime or create its files');
      await runtime.start();
      assert.equal((await new RuntimeDiagnostics(settings).doctor()).ok, true);
      const adminHeaders = { authorization: 'Bearer ' + new RuntimeCredentials(settings).readAdminToken() };
      const saved = await fetch(settings.url + '/api/routes', { method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic diagnostics', prefix: 'probe-fixture', upstreamUrl: 'http://127.0.0.1:' + (upstream.address() as { port: number }).port }) });
      assert.equal(saved.status, 201);
      const probe = new RuntimeProbe(settings, { PROBE_CREDENTIAL: credential });
      for (const format of ['openai', 'anthropic']) {
        const result = await probe.run({ connection: 'probe-fixture', model: 'synthetic', format, credentialEnv: 'PROBE_CREDENTIAL', credentialHeader: 'authorization', credentialPrefix: 'Bearer ' });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.masked, true);
        assert.equal(result.restored, true);
        assert.equal(authenticated, true);
        assert.equal(JSON.stringify(result).includes(credential), false);
      }
      assert.equal(leakedCanary, false);
      fail = true;
      const denied = await probe.run({ connection: 'probe-fixture', model: 'synthetic', format: 'openai' });
      assert.equal(denied.ok, false);
      assert.equal(denied.cleanup, true);
      assert.equal(JSON.stringify(denied).includes(credential), false);
      assert.match(denied.message, /HTTP 403/);
      assert.equal(runtime.getVault().getManualSecrets().some(entry => entry.key.startsWith('CG_PROBE_')), false);
      const sessions = await fetch(settings.url + '/api/sessions', { headers: adminHeaders }).then(response => response.json()) as unknown[];
      assert.equal(sessions.length, 0);
      await assert.rejects(probe.run({ connection: 'probe-fixture', model: 'synthetic', format: 'openai', endpoint: '/api/export' }), /exact local request path/);
      await assert.rejects(probe.run({ connection: 'probe-fixture', model: 'synthetic', format: 'openai', credentialEnv: 'PROBE_CREDENTIAL' }), /credential source\/header/);
      console.log('PASS diagnostics: read-only stopped doctor, verified runtime+MCP, independent OpenAI/Anthropic provider roundtrip, exact masked session evidence, synthetic cleanup and no credential output');
    } finally { await runtime.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  };
}

await new DiagnosticsTests().run();
