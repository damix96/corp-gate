import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { VaultCatalogServer } from '../src/mcp/catalog-server.js';
import { SecretInputManager } from '../src/secret-input/manager.js';
import { SecretInputBrowser } from '../src/secret-input/browser-launcher.js';
import { SecretInputView } from '../src/secret-input/schema.js';

const original = 'synthetic-intake-not-in-protocol-秘密';
const saved = new Map<string, string>();
let launchCount = 0;
const input = new SecretInputManager({
  inspect: (_operation, names) => names.map(name => ({ name, expectedRevision: null })),
  commit: async (_operation, values) => {
    values.forEach(entry => saved.set(entry.name, entry.value));
    return { variables: values.map(entry => ({ name: entry.name, token: '$${<' + entry.name + '>}' })) };
  },
}, new SecretInputBrowser('win32', async () => { launchCount++; return true; }));
const provider = { listVariables: () => ({ revision: String(saved.size), variables: [...saved.keys()].map(name => ({ name, token: '$${<' + name + '>}', source: 'fixed' as const })) }) };
const clients = [new Client({ name: 'input-one', version: 'test' }), new Client({ name: 'input-two', version: 'test' })];
const servers = clients.map(() => new VaultCatalogServer(provider, '0.2.0-test', { manager: input, origin: 'http://127.0.0.1:12345' }));
const transcript: unknown[] = [];
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  transcript.push(result);
  return result;
};
try {
  for (let index = 0; index < clients.length; index++) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await servers[index].connect(serverTransport);
    await clients[index].connect(clientTransport);
  }
  const listed = await clients[0].listTools();
  transcript.push(listed, clients[0].getInstructions());
  assert.equal(listed.tools.length, 5);
  assert.ok(listed.tools.some(tool => tool.name === 'corpgate_open_dashboard'));
  assert.ok(!listed.tools.some(tool => /submit|reveal/.test(tool.name)));
  for (const operation of ['new', 'update']) assert.equal((await call(clients[0], 'corpgate_request_secret_input', { operation, names: ['REJECTED'], idempotencyKey: operation })).isError, true);
  const args = { operation: 'set', names: ['FIRST', 'SECOND'], idempotencyKey: randomUUID() };
  const requested = await call(clients[0], 'corpgate_request_secret_input', args);
  const view = requested.structuredContent as SecretInputView;
  assert.equal(view.state, 'awaiting_input');
  assert.equal(view.launch, 'attempted');
  assert.equal(launchCount, 1);
  assert.deepEqual((await call(clients[1], 'corpgate_request_secret_input', args)).structuredContent, view);
  assert.equal(launchCount, 1);
  assert.deepEqual((await call(clients[1], 'corpgate_secret_input_status', { requestId: view.requestId })).structuredContent, view);
  const dashboard = await call(clients[0], 'corpgate_open_dashboard', { tab: 'vault' });
  assert.equal(dashboard.isError, undefined);
  assert.deepEqual(dashboard.structuredContent, { url: 'http://127.0.0.1:12345/#vault', launch: 'attempted' });
  assert.equal(launchCount, 2);
  const badNameReq = await call(clients[0], 'corpgate_request_secret_input', { ...args, names: ['BAD NAME'] });
  assert.equal(badNameReq.isError, true);
  assert.equal(badNameReq.structuredContent, undefined);
  assert.ok((badNameReq as any).content[0].text.includes('Input validation error'));
  assert.equal((await call(clients[0], 'corpgate_request_secret_input', { ...args, value: original })).isError, true);
  const notUuidReq = await call(clients[0], 'corpgate_secret_input_status', { requestId: 'not-a-uuid' });
  assert.equal(notUuidReq.isError, true);
  assert.equal(notUuidReq.structuredContent, undefined);
  assert.ok((notUuidReq as any).content[0].text.includes('Input validation error'));
  const metaArgs = { operation: 'set', variables: [{ name: 'META_VAR', description: 'Test description', isSecret: true }], idempotencyKey: randomUUID() };
  const metaReq = await call(clients[0], 'corpgate_request_secret_input', metaArgs);
  const metaView = metaReq.structuredContent as SecretInputView;
  assert.equal(metaView.state, 'awaiting_input');
  assert.deepEqual(metaView.variables, [{ name: 'META_VAR', description: 'Test description', isSecret: true }]);
  assert.equal(metaView.url, 'http://127.0.0.1:12345/vault/set/' + (metaView.shortId ?? metaView.requestId));
  assert.ok(metaView.shortId && /^[a-f0-9]{4}$/.test(metaView.shortId));
  assert.equal(new URL(metaView.url).search, '');
  const metaArgs2 = { operation: 'set', variables: [{ name: 'META_VAR', description: 'Updated test description', isSecret: true }], idempotencyKey: randomUUID() };
  const metaReq2 = await call(clients[1], 'corpgate_request_secret_input', metaArgs2);
  assert.equal(metaReq2.isError, undefined);
  const metaView2 = metaReq2.structuredContent as SecretInputView;
  assert.equal(metaView2.state, 'awaiting_input');
  assert.notEqual(metaView2.requestId, metaView.requestId);
  const oldStatus = await call(clients[0], 'corpgate_secret_input_status', { requestId: metaView.requestId });
  assert.equal((oldStatus.structuredContent as SecretInputView).state, 'cancelled');
  const shortStatus = await call(clients[0], 'corpgate_secret_input_status', { requestId: metaView.shortId! });
  assert.equal((shortStatus.structuredContent as SecretInputView).state, 'cancelled');
  const conflictReq = await call(clients[0], 'corpgate_request_secret_input', { operation: 'set', names: ['CONFLICT_ONE'], idempotencyKey: metaArgs.idempotencyKey });
  assert.equal(conflictReq.isError, true);
  assert.equal(conflictReq.structuredContent, undefined);
  const parsedErr = JSON.parse((conflictReq as any).content[0].text);
  assert.equal(parsedErr.error.code, 'REQUEST_CONFLICT');
  assert.ok(!parsedErr.error.message.includes('Vault catalog is temporarily unavailable'));
  assert.equal(saved.size, 0);
  await input.submit(view.requestId, { submissionId: randomUUID(), values: args.names.map(name => ({ name, value: original })) });
  const completed = await call(clients[1], 'corpgate_secret_input_status', { requestId: view.requestId });
  assert.equal((completed.structuredContent as SecretInputView).state, 'completed');
  assert.equal(saved.get('FIRST'), original);
  const catalog = await call(clients[0], 'corpgate_list_variables', {});
  assert.equal((catalog.structuredContent as { variables: unknown[] }).variables.length, 2);
  const pending = await call(clients[0], 'corpgate_request_secret_input', { operation: 'set', names: ['FIRST'], idempotencyKey: randomUUID() });
  const cancelled = await call(clients[1], 'corpgate_cancel_secret_input', { requestId: (pending.structuredContent as SecretInputView).requestId });
  assert.equal((cancelled.structuredContent as SecretInputView).state, 'cancelled');
  const upsert = await call(clients[0], 'corpgate_request_secret_input', { names: ['UPSERT_VAR'], idempotencyKey: randomUUID() });
  const upsertView = upsert.structuredContent as SecretInputView;
  assert.equal(upsertView.operation, 'set');
  assert.equal(upsertView.url, 'http://127.0.0.1:12345/vault/set/' + (upsertView.shortId ?? upsertView.requestId));
  await call(clients[0], 'corpgate_cancel_secret_input', { requestId: upsertView.requestId });
  assert.equal(saved.get('FIRST'), original);
  for (const sensitive of [original, encodeURIComponent(original), Buffer.from(original).toString('base64')]) assert.equal(JSON.stringify(transcript).includes(sensitive), false);
  console.log('Secret input official SDK/two clients/metadata catalog PASS');
} finally {
  await Promise.all(clients.map(client => client.close()));
  await Promise.all(servers.map(server => server.mcp.close()));
  await input.close();
}
