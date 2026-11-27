import assert from 'node:assert/strict';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';

class EnvFileMaskingTests {
  private values = { SERVICE_URL: 'https://synthetic-service.corp.example/api', SERVICE_TOKEN: 'synthetic-token-0123456789', DB_PASSWORD: 'synthetic-db-password' };

  private request = async (anthropic: boolean): Promise<void> => {
    const database = new VaultDatabase(':memory:');
    const vault = new VaultStore(database);
    for (const [key, value] of Object.entries(this.values)) vault.setManualSecret(key, value);
    const file = Object.entries(this.values).map(([key, value]) => key + '=' + value).join('\n') + '\nFEATURE_FLAG=true\n';
    const command = 'curl -H "Authorization: Bearer $${<SERVICE_TOKEN>}" $${<SERVICE_URL>}/health';
    const reply = anthropic
      ? { content: [{ type: 'tool_use', id: 'service-call', name: 'shell', input: { command } }] }
      : { choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'service-call', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command }) } }] } }] };
    const originalFetch = globalThis.fetch;
    let outgoing = '';
    globalThis.fetch = async (_url, init) => {
      outgoing = String(init?.body);
      return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
    };
    const proxy = new CorpGateProxyServer(vault);
    globalThis.fetch = originalFetch;
    const payload = anthropic
      ? { model: 'synthetic', max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-env', content: file }] }] }
      : { model: 'synthetic', messages: [{ role: 'tool', tool_call_id: 'read-env', content: file }] };
    const unchanged = JSON.stringify(payload);
    try {
      const result = await proxy.getApp().inject({ method: 'POST', url: anthropic ? '/anthropic/v1/messages' : '/opencode/v1/chat/completions', payload });
      assert.equal(result.statusCode, 200);
      for (const [key, value] of Object.entries(this.values)) {
        assert.equal(outgoing.includes(value), false, key + ' leaked from the unrelated file content');
        assert.ok(outgoing.includes('$${<' + key + '>}'), key + ' must remain available symbolically');
      }
      assert.ok(outgoing.includes('FEATURE_FLAG=true'));
      assert.equal(JSON.stringify(payload), unchanged);
      const decoded = result.json();
      const actualCommand = anthropic ? decoded.content[0].input.command : JSON.parse(decoded.choices[0].message.tool_calls[0].function.arguments).command;
      assert.equal(actualCommand, 'curl -H "Authorization: Bearer ' + this.values.SERVICE_TOKEN + '" ' + this.values.SERVICE_URL + '/health');
      assert.equal(actualCommand.includes('$${<'), false);
    } finally { await proxy.close(); database.close(); }
  };

  public run = async (): Promise<void> => {
    await this.request(false);
    await this.request(true);
    console.log('PASS whole .env tool output: all registered credentials masked, ordinary lines preserved, local service command restored for OpenAI and Anthropic');
  };
}

await new EnvFileMaskingTests().run();
