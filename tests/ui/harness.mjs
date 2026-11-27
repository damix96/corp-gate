import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { UiTestHost } from './ui-test-host.mjs';

export class UiBrowserHarness {
  host = new UiTestHost();
  browser = null;
  context = null;
  page = null;
  errors = [];
  baseUrl = '';
  allowedErrors = [];

  allowResponse = fn => this.allowedErrors.push(fn);

  init = async (seed = () => {}, config = {}) => {
    if (process.env.UI_TEST_PACKAGE_ROOT) this.host.root = resolve(process.env.UI_TEST_PACKAGE_ROOT);
    await this.host.init(seed, config);
    this.baseUrl = await this.host.server.listen();
    this.browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => chromium.launch({ headless: true })).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    await this.context.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
    await this.host.isolateClipboard(this.context);
    this.page = await this.context.newPage();
    this.page.on('pageerror', err => this.errors.push('PageError: ' + (err.stack || err.message || err)));
    this.page.on('console', msg => msg.type() === 'error' && this.errors.push('ConsoleError: ' + msg.text()));
    this.page.on('response', res => {
      if (res.status() >= 400 && !this.allowedErrors.some(fn => fn(res))) {
        this.errors.push(`HttpError: ${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });
  };

  adminHeaders = () => ({ authorization: 'Bearer ' + this.host.server.getAdminToken() });

  open = async (path = '/dashboard#overview', auth = true) => {
    let target = path;
    if (auth && this.host.server && (path === '/' || path.startsWith('/#') || path.startsWith('/dashboard'))) {
      const url = new URL(path, this.baseUrl);
      if (!url.searchParams.has('token')) url.searchParams.set('token', this.host.server.getAdminToken());
      target = url.pathname + url.search + url.hash;
    }
    await this.page.goto(this.baseUrl + target, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('#root');
  };

  assertClean = () => {
    const errs = [...this.errors];
    this.errors = [];
    this.allowedErrors = [];
    assert.equal(errs.length, 0, errs.join('\n'));
  };

  close = async () => {
    if (this.browser) await this.browser.close().catch(() => {});
    await this.host.close();
  };

  seedSecret = (key, realValue, description = '', maskInAi = 1) => {
    this.host.database.upsertSecret({
      key, real_value: realValue, alias: '$${<' + key + '>}',
      mask_in_ai: maskInAi ? 1 : 0, description,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    if (this.host.server?.getVault()) {
      const entry = this.host.server.getVault().setManualSecret(key, realValue, description);
      if (!maskInAi) this.host.server.getVault().toggleSecretMask(key);
      return entry;
    }
  };

  seedAutoSecret = (key, realValue, hitCount = 1) => {
    this.host.database.upsertAutoSecret({
      key, real_value: realValue, alias: 'AUTO_' + key.toUpperCase(),
      hit_count: hitCount, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString()
    });
    if (this.host.server?.getVault()) {
      const entry = this.host.server.getVault().setAutoSecret(key, realValue);
      entry.hitCount = hitCount;
      return entry;
    }
  };

  seedPattern = (id, name, pattern, type = 'regex', labelTemplate = null, enabled = 1) =>
    this.host.database.upsertPattern({
      id, name, pattern, type, label_template: labelTemplate,
      enabled: enabled ? 1 : 0, created_at: new Date().toISOString()
    });

  seedRoute = (id, name, prefix, upstreamUrl, description = '', isCustom = 0) =>
    this.host.database.upsertRoute({
      id, name, prefix, upstream_url: upstreamUrl, description, is_custom: isCustom ? 1 : 0
    });

  seedTransaction = row => this.host.seedTransaction(row);

  seedActiveTransaction = row => this.host.seedActiveTransaction(row);

  broadcast = event => this.host.server.getEventBroadcaster().broadcast(event);
}
