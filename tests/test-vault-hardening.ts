import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase } from '../src/vault/sqlite-db.js';
import { VaultStore } from '../src/vault/store.js';
import { PatternEngine } from '../src/vault/pattern-engine.js';
import { AutoSecretStore } from '../src/vault/auto-secrets.js';
import { AnyIpRule } from '../src/vault/any-ip-rule.js';
import { LabelTemplate } from '../src/vault/label-template.js';
import { CorpGateProxyServer } from '../src/proxy/server.js';
import { SecretProvider } from '../src/security/secret-provider.js';

class VaultHardeningTests {
  private dir = mkdtempSync(join(tmpdir(), 'corpgate-hardening-'));

  private testToggleMaskEncrypted = (): void => {
    const file = join(this.dir, 'toggle-mask.db');
    const provider: SecretProvider = { id: process.platform === 'darwin' ? 'macos-keychain' : process.platform === 'linux' ? 'linux-secret-service' : 'windows-dpapi', encrypt: (v, c) => Buffer.from(v.map((b, i) => b ^ c[i % c.length])), decrypt: (v, c) => Buffer.from(v.map((b, i) => b ^ c[i % c.length])) };
    let db = new VaultDatabase(file, provider);
    let vault = new VaultStore(db);
    const created = vault.setManualSecret('MASK_TARGET', 'secret-value-keep-me', 'desc', true);
    assert.equal(created.isSecret, true);
    assert.equal(created.maskInAi, true);
    assert.equal(db.getSecrets()[0].real_value, '');
    assert.equal(vault.toggleSecretMask('MASK_TARGET'), true);
    assert.equal(vault.getManualSecrets()[0].maskInAi, false);
    db.close();
    db = new VaultDatabase(file, provider);
    vault = new VaultStore(db);
    const reloaded = vault.getManualSecrets().find(entry => entry.key === 'MASK_TARGET')!;
    assert.equal(reloaded.isSecret, true);
    assert.equal(reloaded.maskInAi, false);
    assert.equal(reloaded.realValue, 'secret-value-keep-me');
    assert.equal(vault.unmaskInboundText('$${<MASK_TARGET>}'), 'secret-value-keep-me');
    db.close();
  };

  private testDefaultIsSecret = (): void => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const expectedDefault = db.protectedStorage.isAvailable();
    const autoDefault = vault.setManualSecret('AUTO_DEFAULT', 'default-secret-value');
    assert.equal(Boolean(autoDefault.isSecret), expectedDefault);
    if (expectedDefault) assert.equal(db.getSecrets().find(r => r.key === 'AUTO_DEFAULT')!.real_value, '');
    const explicitPlain = vault.setManualSecret('EXPLICIT_PLAIN', 'plain-value', undefined, false);
    assert.equal(explicitPlain.isSecret, false);
    assert.equal(db.getSecrets().find(r => r.key === 'EXPLICIT_PLAIN')!.real_value, 'plain-value');
    db.close();
    const unavailableDb = new VaultDatabase(':memory:');
    unavailableDb.protectedStorage.isAvailable = () => false;
    const headlessVault = new VaultStore(unavailableDb);
    assert.equal(headlessVault.setManualSecret('HEADLESS', 'headless-value').isSecret, false);
    unavailableDb.close();
  };

  private testAutoSecretsSqliteTtl = (): void => {
    const file = join(this.dir, 'auto-ttl.db');
    const legacy = new DatabaseSync(file);
    legacy.exec('CREATE TABLE auto_secrets (key TEXT PRIMARY KEY, real_value TEXT, alias TEXT, hit_count INTEGER, first_seen_at TEXT, last_seen_at TEXT);');
    legacy.prepare('INSERT INTO auto_secrets VALUES (?, ?, ?, ?, ?, ?)').run('AUTO_EXPIRED', 'expired-secret-val', '$${<AUTO_EXPIRED>}', 1, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');
    legacy.close();
    let db = new VaultDatabase(file);
    let vault = new VaultStore(db);
    assert.equal(vault.findByValue('expired-secret-val'), undefined);
    assert.equal(db.getAutoSecrets().length, 0);
    const active = vault.registerAutoDetectedSecret('persisted-auto-token-123456', 'token');
    const duplicate = vault.registerAutoDetectedSecret('same-as-manual-123456', 'token');
    db.upsertAutoSecret({ key: 'AUTO_TTL_EXPIRED', real_value: 'ttl-old-val', alias: '$${<AUTO_TTL_EXPIRED>}', hit_count: 1, first_seen_at: new Date(Date.now() - AutoSecretStore.TTL_MS - 60000).toISOString(), last_seen_at: new Date(Date.now() - AutoSecretStore.TTL_MS - 60000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() });
    db.close();
    db = new VaultDatabase(file);
    vault = new VaultStore(db);
    assert.equal(vault.findByValue('ttl-old-val'), undefined);
    assert.equal(vault.findByValue('persisted-auto-token-123456')?.alias, active.alias);
    assert.equal(vault.unmaskInboundText(active.alias), 'persisted-auto-token-123456');
    vault.setManualSecret('MANUAL_SAME_VALUE', 'same-as-manual-123456');
    assert.equal(vault.getAutoSecrets().some(entry => entry.key === duplicate.key), false);
    assert.equal(db.getAutoSecrets().some(row => row.key === duplicate.key), false);
    vault.promote(active.key);
    assert.equal(db.getAutoSecrets().length, 0);
    db.close();
    db = new VaultDatabase(file);
    vault = new VaultStore(db);
    assert.equal(vault.unmaskInboundText(active.alias), 'persisted-auto-token-123456');
    db.close();
  };

  private testRe2jsLinearAndValidation = (): void => {
    const db = new VaultDatabase(':memory:');
    const engine = new PatternEngine(db);
    for (const bad of ['(?=foo)bar', '(?!foo)bar', '(?<=foo)bar', '(?<!foo)bar', '(a)\\1', '[unclosed']) {
      assert.equal(PatternEngine.isValidRegex(bad), false);
      assert.equal(engine.addPattern('bad_' + randomUUID().slice(0, 4), bad, 'custom'), null);
      assert.throws(() => LabelTemplate.validate(bad, null));
    }
    const redos = engine.addPattern('redos_safe', '(a+)+b', 'custom');
    assert.ok(redos);
    const start = performance.now();
    engine.scanAndAutoDetect('a'.repeat(5000) + 'c', () => {});
    assert.ok(performance.now() - start < 200);
    db.close();
  };

  private testEnvLikeAndNoMatryoshka = (): void => {
    const db = new VaultDatabase(':memory:');
    const engine = new PatternEngine(db);
    const vault = new VaultStore(db);
    const kept = [
      'SHORT_PASSWORD=short', 'JUNK_PASSWORD=changeme', 'JUNK_KEY=your_api_key_here', 'JUNK_EX=example_value_123',
      'JUNK_PL=placeholder_val', 'JUNK_DU=dummy_password', 'JUNK_TS=test', 'JUNK_LH=localhost', 'JUNK_TR=true',
      'JUNK_FA=false', 'JUNK_NU=null', 'JUNK_ST=********', 'REF_PASSWORD=${OTHER_SECRET}', 'REF_TOKEN=$OTHER_TOKEN',
      'ALREADY_MASKED_PASSWORD=$${<MANUAL_PASS>}', 'NESTED_TOKEN=prefix_$${<MANUAL_PASS>}_suffix', 'APP_PORT=80800000',
      'AUTH_HEADER="Authorization"', 'TOKEN_TYPE="refresh_token"', 'SECRET_PATH="/etc/secrets"', 'SECRET_DIR="./secrets"',
      'TOKEN_FILE="../secrets_key"', 'API_KEY_NAME="OPENAI_API_KEY_1"', 'PASS_FIELD="password_123"', 'AUTH_LABEL="BearerAuth1"',
      'TOKEN_PREFIX="Bearer_123"', 'TOKEN_SUFFIX="_suffix_123"', 'KEY_FORMAT="pem_pkcs8_1"', 'AUTH_ALGORITHM="HS256_HMAC"',
      'TOKEN_TTL="36000000"', 'AUTH_TIMEOUT="50000000"', 'AUTH_ENABLED="enabled_1"', 'SECRET_FLAG="flag_true_1"',
      'AUTH_MODE="strict_mode1"', 'PATH_ABS=/var/run/secret_1', 'PATH_REL=./local/secret_1', 'PATH_PAR=../parent/sec_1',
      'PATH_HOME=~/home/secret_1', 'SHORT_WORDS_SECRET=simple_word_val',
    ];
    const sample = [
      'DB_PASSWORD=my_super_secret_1', 'LONG_SECRET=correct_horse_battery', 'DIGIT_PASSWORD=sec_ret_1',
      'QUOTED_SECRET="quoted_super_secret_1"', "SINGLE_TOKEN='single_token_secret_2'", 'OPENAI_API_KEY=sk-1234567890abcdef123456', ...kept,
    ].join('\n');
    engine.scanAndAutoDetect(sample, (match, type, prefix) => vault.registerAutoDetectedSecret(match, type, prefix));
    const masked = vault.maskOutboundText(sample);
    for (const secret of ['my_super_secret_1', 'correct_horse_battery', 'sec_ret_1', 'quoted_super_secret_1', 'single_token_secret_2', 'sk-1234567890abcdef123456']) assert.ok(!masked.includes(secret));
    assert.match(masked, /DB_PASSWORD=\$\$\{<AUTO_ENV_DB_PASSWORD_[A-Z0-9]+>\}/);
    assert.match(masked, /QUOTED_SECRET="\$\$\{<AUTO_ENV_QUOTED_SECRET_[A-Z0-9]+>\}"/);
    assert.match(masked, /SINGLE_TOKEN='\$\$\{<AUTO_ENV_SINGLE_TOKEN_[A-Z0-9]+>\}'/);
    assert.equal((masked.match(/OPENAI_API_KEY=\$\$\{<[A-Z0-9_]+>\}/g) || []).length, 1);
    for (const line of kept) assert.ok(masked.includes(line), 'Expected unmasked: ' + line);
    assert.equal(vault.unmaskInboundText(masked), sample);
    db.close();
  };

  private testJwtAndEnvOrderAndCodeExclusions = (): void => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const plainDb = new VaultDatabase(':memory:'), plainEngine = new PatternEngine(plainDb), plainVault = new VaultStore(plainDb);
    const codeSamples = ['API_KEY = config.apiKey', 'DB_PASSWORD = getPassword()', 'AUTH_TOKEN = os.environ["KEY"]', 'SECRET_KEY = process.env.SECRET_KEY', 'API_KEY = os.getenv("KEY")', 'AUTH_TOKEN = settings.token', 'DB_PASSWORD = this.password', 'API_KEY = self.apiKey', 'SECRET_KEY = env.secretKey', 'AUTH_TOKEN = req.authToken', 'API_KEY = res.localsKey'];
    const plainSample = `Token is ${jwt}\n${codeSamples.join('\n')}`;
    plainEngine.scanAndAutoDetect(plainSample, (match, type, prefix) => plainVault.registerAutoDetectedSecret(match, type, prefix));
    const plainMasked = plainVault.maskOutboundText(plainSample);
    assert.equal(plainMasked.includes(jwt), false);
    assert.match(plainMasked, /^Token is \$\$\{<AUTO_TOKEN_[A-Z0-9]+>\}/);
    for (const line of codeSamples) assert.ok(plainMasked.includes(line), 'Expected code expression unmasked: ' + line);
    assert.equal(plainVault.unmaskInboundText(plainMasked), plainSample);
    plainDb.close();
    for (const envFirst of [false, true]) {
      const db = new VaultDatabase(':memory:'), engine = new PatternEngine(db), vault = new VaultStore(db);
      const apiRule = db.getPatterns().find(p => p.id === 'pat_api_keys')!, envRule = db.getPatterns().find(p => p.id === 'pat_env_like')!;
      db.upsertPattern({ ...apiRule, created_at: envFirst ? '2020-01-02T00:00:00.000Z' : '2020-01-01T00:00:00.000Z' });
      db.upsertPattern({ ...envRule, created_at: envFirst ? '2020-01-01T00:00:00.000Z' : '2020-01-02T00:00:00.000Z' });
      assert.equal(engine.getPatterns().map(p => p.id).indexOf('pat_env_like') < engine.getPatterns().map(p => p.id).indexOf('pat_api_keys'), envFirst);
      const envJwt = `AUTH_TOKEN=${jwt}\nSPACED_TOKEN = ${jwt}`;
      engine.scanAndAutoDetect(envJwt, (match, type, prefix) => vault.registerAutoDetectedSecret(match, type, prefix));
      assert.equal(vault.getAutoSecrets().length, 1);
      const masked = vault.maskOutboundText(envJwt);
      assert.equal(masked.includes(jwt), false);
      assert.match(masked, /^AUTH_TOKEN=\$\$\{<AUTO_(?:ENV_AUTH_)?TOKEN_[A-Z0-9]+>\}\nSPACED_TOKEN = \$\$\{<AUTO_(?:ENV_AUTH_)?TOKEN_[A-Z0-9]+>\}$/);
      assert.equal((masked.match(/\$\$\{/g) || []).length, 2);
      assert.equal(vault.unmaskInboundText(masked), envJwt);
      db.close();
    }
    const migratedDb = new VaultDatabase(':memory:');
    migratedDb.upsertPattern({ id: 'pat_api_keys', name: 'api-keys', pattern: '(?:\\bAKIA[0-9A-Z]{16}\\b)', type: 'token', enabled: 1, created_at: '2020-01-01T00:00:00Z' });
    migratedDb.setSetting('rule_api_keys_jwt_v1', '');
    const hits: string[] = [];
    new PatternEngine(migratedDb).scanAndAutoDetect(jwt, match => hits.push(match));
    assert.deepEqual(hits, [jwt]);
    migratedDb.close();
  };

  private testAnyIpRfc1918AndMigration = (): void => {
    const file = join(this.dir, 'ip-migration.db');
    let db = new VaultDatabase(file);
    db.setSetting('rule_any_ip_installed', '1');
    db.upsertPattern({ id: AnyIpRule.id, name: 'any-ip', pattern: '(?<![\\w.])127\\.0\\.0\\.1(?![\\w.])', type: 'ip', enabled: 1, created_at: new Date().toISOString() });
    db.close();
    db = new VaultDatabase(file);
    const engine = new PatternEngine(db);
    const vault = new VaultStore(db);
    const text = 'loop=127.0.0.1 zero=0.0.0.0 bcast=255.255.255.255 dns=8.8.8.8 cf=1.1.1.1 pub172=172.15.0.1 pub172b=172.32.0.1 ver=1.10.0.0.1 priv10=10.0.1.5 priv172=172.16.4.8 priv172hi=172.31.255.254 priv192=192.168.1.42';
    engine.scanAndAutoDetect(text, (match, type, prefix) => vault.registerAutoDetectedSecret(match, type, prefix));
    const masked = vault.maskOutboundText(text);
    for (const keep of ['127.0.0.1', '0.0.0.0', '255.255.255.255', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '1.10.0.0.1']) {
      assert.ok(masked.includes(keep), 'Expected public/special IP unmasked: ' + keep);
    }
    for (const priv of ['10.0.1.5', '172.16.4.8', '172.31.255.254', '192.168.1.42']) {
      assert.ok(!masked.includes(priv), 'Expected RFC1918 IP masked: ' + priv);
    }
    assert.equal(vault.unmaskInboundText(masked), text);
    db.close();
  };

  private testDefaultPatternsPrecisionAndDedup = (): void => {
    const db = new VaultDatabase(':memory:');
    const engine = new PatternEngine(db);
    const vault = new VaultStore(db);
    assert.equal(engine.getPatterns().filter(p => p.type === 'ip').length, 1);
    const safeTexts = [
      'use a Bearer token and bearer auth or bearer header',
      'http://localhost:3000/api https://localstack.cloud/v1 https://worldbank.org/data https://github.com/org/app.internal',
      'bad_ip=10.999.999.999',
    ];
    for (const safe of safeTexts) {
      const hits: string[] = [];
      engine.scanAndAutoDetect(safe, match => hits.push(match));
      assert.deepEqual(hits, [], 'Expected no match for: ' + safe);
    }
    const bearerJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
    const ghPat = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop';
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const glPat = 'glpat-1234567890abcdefghij';
    const slackTok = 'xoxb-1234567890-1234567890-abcdef';
    const googleKey = 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGt688';
    const stripeSk = 'sk_live_51H7abc1234567890';
    const stripeRk = 'rk_live_51H7abc1234567890';
    const corpUrl = 'https://api.corp.internal/v1';
    const dbUri = 'postgres://admin:pass@10.0.1.5:5432/db';
    const sample = `Authorization: Bearer ${bearerJwt}\n${ghPat} ${awsKey} ${glPat} ${slackTok} ${googleKey} ${stripeSk} ${stripeRk}\n${corpUrl} \`${dbUri}\` (${dbUri}); 192.168.1.10:8080`;
    engine.scanAndAutoDetect(sample, (match, type, prefix) => vault.registerAutoDetectedSecret(match, type, prefix));
    const masked = vault.maskOutboundText(sample);
    assert.ok(masked.includes('Authorization: Bearer $${<AUTO_TOKEN_'), 'Bearer prefix must stay unmasked');
    assert.ok(masked.includes('`' + '$${<AUTO_URI_'), 'Backticks must not be swallowed into URI secret');
    assert.ok(masked.includes('(' + '$${<AUTO_URI_'), 'Parens must not be swallowed into URI secret');
    for (const secret of [bearerJwt, ghPat, awsKey, glPat, slackTok, googleKey, stripeSk, stripeRk, corpUrl, dbUri, '192.168.1.10:8080']) {
      assert.ok(!masked.includes(secret), 'Expected secret masked: ' + secret);
    }
    assert.equal(vault.unmaskInboundText(masked), sample);
    db.close();
  };

  private testPatternCacheAndDedupMigration = (): void => {
    const file = join(this.dir, 'dedup-cache.db');
    let db = new VaultDatabase(file);
    db.upsertPattern({ id: AnyIpRule.privateId, name: 'private-ip', pattern: '\\b10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', type: 'ip', enabled: 1, created_at: '2025-01-01T00:00:00Z' });
    db.upsertPattern({ id: AnyIpRule.id, name: 'any-ip', pattern: AnyIpRule.pattern, type: 'ip', enabled: 1, created_at: '2025-01-02T00:00:00Z' });
    db.close();
    db = new VaultDatabase(file);
    const engine = new PatternEngine(db);
    assert.equal(engine.getPatterns().some(p => p.id === AnyIpRule.id), false);
    assert.equal(engine.getPatterns().filter(p => p.id === AnyIpRule.privateId).length, 1);
    let calls = 0;
    const origGet = db.getPatterns;
    db.getPatterns = () => { calls++; return origGet(); };
    const hits: string[] = [];
    engine.scanAndAutoDetect('custom_token_alpha', match => hits.push(match));
    engine.scanAndAutoDetect('custom_token_alpha', match => hits.push(match));
    engine.scanAndAutoDetect('custom_token_alpha', match => hits.push(match));
    assert.equal(calls, 1);
    const custom = engine.addPattern('custom-tok', 'custom_token_[a-z]+', 'custom')!;
    engine.scanAndAutoDetect('custom_token_alpha', match => hits.push(match));
    assert.deepEqual(hits, ['custom_token_alpha']);
    assert.equal(calls, 2);
    db.upsertPattern({ id: 'pat_direct', name: 'direct', pattern: 'direct_secret_[a-z]+', type: 'custom', enabled: 1, created_at: new Date().toISOString() });
    engine.scanAndAutoDetect('direct_secret_beta', match => hits.push(match));
    assert.ok(hits.includes('direct_secret_beta'));
    assert.equal(calls, 3);
    engine.togglePattern(custom.id);
    const afterToggle: string[] = [];
    engine.scanAndAutoDetect('custom_token_alpha', match => afterToggle.push(match));
    assert.deepEqual(afterToggle, []);
    db.close();
  };

  private testAutoSecretsProtectedStorageAndApi = async (): Promise<void> => {
    const file = join(this.dir, 'auto-protected.db');
    const provider: SecretProvider = { id: process.platform === 'darwin' ? 'macos-keychain' : process.platform === 'linux' ? 'linux-secret-service' : 'windows-dpapi', encrypt: (v, c) => Buffer.from(v.map((b, i) => b ^ c[i % c.length])), decrypt: (v, c) => Buffer.from(v.map((b, i) => b ^ c[i % c.length])) };
    let db = new VaultDatabase(file, provider);
    let vault = new VaultStore(db);
    const auto = vault.registerAutoDetectedSecret('sk-auto-protected-secret-999', 'token');
    const row = db.getAutoSecrets().find(r => r.key === auto.key)!;
    assert.equal(auto.isSecret, true); assert.equal(row.is_secret, 1); assert.equal(row.real_value, ''); assert.ok(row.protected_value && row.protected_value.length > 0);
    db.close(); db = new VaultDatabase(file, provider); vault = new VaultStore(db);
    assert.equal(vault.findByValue('sk-auto-protected-secret-999')?.alias, auto.alias); assert.equal(vault.unmaskInboundText(auto.alias), 'sk-auto-protected-secret-999');
    const server = new CorpGateProxyServer(vault, { port: 0 });
    const app = server.getApp();
    const authHeaders = { authorization: 'Bearer ' + server.getAdminToken() };
    try {
      const hiddenVault = (await app.inject({ url: '/api/vault', headers: authHeaders })).json();
      const hiddenAuto = hiddenVault.auto.find((item: { key: string }) => item.key === auto.key);
      assert.equal(hiddenAuto.isSecret, true);
      assert.equal(Object.hasOwn(hiddenAuto, 'realValue') || JSON.stringify(hiddenVault).includes('sk-auto-protected-secret-999'), false);
      const hiddenExport = await app.inject({ url: '/api/export?group=secrets', headers: authHeaders });
      const exportedAuto = hiddenExport.json().data.secrets.find((item: { key: string }) => item.key === auto.key);
      assert.equal(exportedAuto.valueOmitted, true);
      assert.equal(Object.hasOwn(exportedAuto, 'real_value') || hiddenExport.body.includes('sk-auto-protected-secret-999'), false);
      const cookie = String((await app.inject({ method: 'GET', url: '/dashboard?token=' + server.getAdminToken(), headers: { host: '127.0.0.1' } })).headers['set-cookie'] || '').split(';')[0];
      const shown = (await app.inject({ method: 'POST', url: '/api/interface/vault', headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', cookie, 'x-corpgate-display': 'original' }, payload: {} })).json();
      assert.equal(shown.auto.find((item: { key: string }) => item.key === auto.key).realValue, 'sk-auto-protected-secret-999');
    } finally { await server.close(); db.close(); }
    const headlessDb = new VaultDatabase(':memory:');
    headlessDb.protectedStorage.isAvailable = () => false;
    const headlessVault = new VaultStore(headlessDb);
    const plain = headlessVault.registerAutoDetectedSecret('sk-auto-headless-plain-123', 'token');
    const plainRow = headlessDb.getAutoSecrets().find(r => r.key === plain.key)!;
    assert.equal(plain.isSecret, false); assert.equal(plainRow.is_secret, 0); assert.equal(plainRow.real_value, 'sk-auto-headless-plain-123'); assert.equal(plainRow.protected_value, '');
    headlessDb.close();
  };

  public run = async (): Promise<void> => {
    try {
      this.testToggleMaskEncrypted(); this.testDefaultIsSecret(); this.testAutoSecretsSqliteTtl();
      await this.testAutoSecretsProtectedStorageAndApi();
      this.testRe2jsLinearAndValidation(); this.testEnvLikeAndNoMatryoshka(); this.testJwtAndEnvOrderAndCodeExclusions(); this.testAnyIpRfc1918AndMigration();
      this.testDefaultPatternsPrecisionAndDedup(); this.testPatternCacheAndDedupMigration();
      console.log('PASS vault hardening: toggleSecretMask persistence, isSecret default, auto-secrets 10d TTL, auto-secrets encryption & API redaction, re2js linear/validation, ENV-like no-matryoshka, RFC1918-only IP rule, pattern precision/dedup/cache');
    } finally { rmSync(this.dir, { recursive: true, force: true }); }
  };
}

await new VaultHardeningTests().run();
