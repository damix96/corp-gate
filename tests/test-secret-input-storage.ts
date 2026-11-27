import assert from 'node:assert/strict';
import { ProtectedInputVault, VaultSecretInputStorage } from '../src/secret-input/storage.js';

const exact = ' \r\nbytes-秘密 ';
let present = false;
let invalidReceipt = false;
let calls = 0;
const vault: ProtectedInputVault = {
  captureSecretTargets: names => names.map(name => ({ name, expectedRevision: present ? 'revision-one' : null })),
  commitProtectedManualBatch: input => {
    calls++;
    assert.deepEqual(input.entries, [{ name: 'KEY', value: exact, expectedRevision: 'revision-one' }]);
    return { requestId: input.requestId, variables: [{ name: 'KEY', token: invalidReceipt ? exact : '$${<KEY>}' }] };
  },
};
const storage = new VaultSecretInputStorage(vault);
assert.deepEqual(storage.inspect('set', ['KEY']), [{ name: 'KEY', expectedRevision: null }]);
present = true;
const snapshot = storage.inspect('set', ['KEY']);
assert.deepEqual(snapshot, [{ name: 'KEY', expectedRevision: 'revision-one' }]);
const receipt = storage.commit('set', snapshot.map(entry => ({ ...entry, value: exact })), 'request-one');
assert.equal(calls, 1);
assert.deepEqual(await receipt, { variables: [{ name: 'KEY', token: '$${<KEY>}' }] });
present = false;
assert.deepEqual(storage.inspect('set', ['KEY']), [{ name: 'KEY', expectedRevision: null }]);
present = true;
assert.deepEqual(storage.inspect('set', ['KEY']), [{ name: 'KEY', expectedRevision: 'revision-one' }]);
const setReceipt = storage.commit('set', snapshot.map(entry => ({ ...entry, value: exact })), 'request-two');
assert.equal(calls, 2);
assert.deepEqual(await setReceipt, { variables: [{ name: 'KEY', token: '$${<KEY>}' }] });
invalidReceipt = true;
await assert.rejects(storage.commit('set', snapshot.map(entry => ({ ...entry, value: exact })), 'request-one'), { code: 'STORE_FAILED' });
assert.throws(() => new VaultSecretInputStorage({ ...vault, captureSecretTargets: () => [] }).inspect('set', ['KEY']), { code: 'STORE_FAILED' });
console.log('Secret input agreed sync storage adapter/value/CAS receipt PASS');
