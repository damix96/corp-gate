import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';

class SharedDatabaseTests {
  public run = (): void => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'corpgate-shared-db-'));
    const file = path.join(directory, 'vault.db');
    const connections: VaultDatabase[] = [];
    try {
      const first = new VaultDatabase(file);
      connections.push(first);
      const firstVault = new VaultStore(first);
      firstVault.setManualSecret('SHARED_FIRST', 'synthetic-first', undefined, false);
      const second = new VaultDatabase(file);
      connections.push(second);
      const secondVault = new VaultStore(second);
      assert.equal(secondVault.unmaskInboundText('$${<SHARED_FIRST>}'), 'synthetic-first');
      secondVault.setManualSecret('SHARED_SECOND', 'synthetic-second', undefined, false);
      assert.equal(first.getSecrets().find(entry => entry.key === 'SHARED_SECOND')?.real_value, 'synthetic-second');
      assert.equal(firstVault.getManualSecrets().some(entry => entry.key === 'SHARED_SECOND'), false);
      first.setSetting('shared-check', 'first');
      assert.equal(second.getSetting('shared-check'), 'first');
      second.setSetting('shared-check', 'second');
      assert.equal(first.getSetting('shared-check'), 'second');
      assert.equal(existsSync(file + '.runtime-lock'), false);
      writeFileSync(file + '.runtime-lock', 'historical-unused-file');
      const third = new VaultDatabase(file);
      connections.push(third);
      assert.equal(new VaultStore(third).unmaskInboundText('$${<SHARED_SECOND>}'), 'synthetic-second');
      assert.equal(new VaultStore(third).unmaskInboundText('$${<SHARED_FIRST>}'), 'synthetic-first');
      console.log('PASS shared DB: multiple stores and connections allowed; durable data visible; RAM remains process-local; stale lease file ignored');
    } finally {
      connections.reverse().forEach(connection => connection.close());
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

new SharedDatabaseTests().run();
