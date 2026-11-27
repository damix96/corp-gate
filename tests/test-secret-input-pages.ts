import assert from 'node:assert/strict';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { TransactionRecord } from '../src/telemetry/types.js';

const db = new VaultDatabase(':memory:');
const vault = new VaultStore(db);
const proxy = new CorpGateProxyServer(vault, { host: '127.0.0.1', port: 0 });
const original = 'synthetic-protected-history-canary';
const updated = 'synthetic-protected-updated-canary';
vault.setManualSecret('PROTECTED', original, undefined, false);
const record: TransactionRecord = {
  id: 'fixture-record', timestamp: new Date().toISOString(),
  request: { method: 'POST', url: '/v1/messages', headers: {}, body: { text: original }, client: 'fixture' },
  response: { status: 200, headers: {}, body: original, isStream: false, client: 'fixture' },
  interceptedSecrets: [{ key: 'PROTECTED', alias: '$${<PROTECTED>}', realValue: original, count: 1, direction: 'inbound' }],
};
try {
  proxy.recordTransaction(record);
  assert.ok(JSON.stringify(proxy.getTransactionHistory()).includes(original));
  const address = await proxy.listen();
  const before = vault.listVariables();
  for (const route of ['/vault/set', '/vault/set?secrets=PROTECTED']) {
    const response = await fetch(address + route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(await response.text(), /<html/i);
    assert.deepEqual(vault.listVariables(), before);
  }
  assert.equal((await fetch(address + '/vault/set', { headers: { origin: 'https://foreign.example' } })).status, 403);
  for (const legacy of ['/vault-secret/new', '/vault-secret/update', '/vault/new', '/vault/update', '/vault/input', '/new', '/update', '/set', '/input']) {
    const redirected = await fetch(address + legacy + '?request=abcd&secrets=FIRST,SECOND&operation=update&url=https://foreign.example', { redirect: 'manual' });
    assert.equal(redirected.status, 302);
    const target = new URL(redirected.headers.get('location')!, address);
    assert.equal(target.origin, address);
    assert.equal(target.pathname, '/vault/set');
    assert.equal(target.searchParams.get('request'), 'abcd');
    assert.equal(target.searchParams.get('secrets'), 'FIRST,SECOND');
    assert.equal(target.searchParams.has('operation'), false);
    assert.equal(target.searchParams.has('url'), false);
    const linked = await fetch(address + legacy + '/abcd?operation=new', { redirect: 'manual' });
    assert.equal(linked.status, 302);
    assert.equal(linked.headers.get('location'), '/vault/set/abcd');
    assert.deepEqual(vault.listVariables(), before);
  }
  assert.equal((await fetch(address + '/vault/new', { headers: { origin: 'https://foreign.example' }, redirect: 'manual' })).status, 403);
  assert.equal(vault.protectManualSecret('PROTECTED')?.isSecret, true);
  assert.equal(vault.unmaskInboundText('$${<PROTECTED>}'), original);
  assert.equal(JSON.stringify(proxy.getTransactionHistory()).includes(original), false);
  assert.equal(JSON.stringify(proxy.getLastCall()).includes(original), false);
  assert.equal(JSON.stringify(proxy.getTransactionById('fixture-record')).includes(original), false);
  assert.equal(record.response?.body, original);
  proxy.recordTransaction({ ...record, id: 'protected-retained' });
  assert.equal(JSON.stringify(proxy.getRuntimeSessions().find('protected-retained')).includes(original), false);
  vault.setManualSecret('PROTECTED', updated, undefined, true);
  assert.equal(vault.unmaskInboundText('$${<PROTECTED>}'), updated);
  assert.equal(JSON.stringify(proxy.getTransactionHistory()).includes(original), false);
  vault.deleteSecret('PROTECTED');
  assert.equal(JSON.stringify(proxy.getTransactionHistory()).includes(original), false);
  console.log('Secret input page GET/no mutation and real protected history projection PASS');
} finally { await proxy.close(); db.close(); }
