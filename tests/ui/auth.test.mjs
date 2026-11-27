import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

test('auth: 401 card unlocks with valid token and ?token= redirects cleanly', async () => {
  const h = new UiBrowserHarness();
  await h.init();
  try {
    h.seedSecret('AUTH_CANARY', 'synthetic-auth-canary');
    h.allowResponse(res => res.status() === 401);
    await h.open('/dashboard#overview', false);
    await h.page.getByRole('heading', { name: /Session is not active|Сессия не активна/i }).waitFor();
    await h.page.getByText('npx corp-gate open').waitFor();
    await h.page.getByText('~/.corpgate/admin.token').waitFor();
    const input = h.page.getByLabel(/Admin token|Токен администратора/i);
    await input.fill('invalid-token');
    await h.page.getByRole('button', { name: /Unlock|Войти/i }).click();
    await h.page.getByText(/Invalid admin token|Неверный токен/i).waitFor();
    h.errors = [];
    await input.fill(h.host.server.getAdminToken());
    await h.page.getByRole('button', { name: /Unlock|Войти/i }).click();
    await h.page.getByRole('tab', { name: /Vault|Сейф/i }).waitFor();
    await h.page.getByRole('tab', { name: /Vault|Сейф/i }).click();
    await h.page.locator('[data-secret-record="AUTH_CANARY"]').waitFor();
    h.assertClean();

    const context = await h.browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('response', res => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
      await page.goto(h.baseUrl + '/?token=' + h.host.server.getAdminToken() + '#secrets', { waitUntil: 'domcontentloaded' });
      await page.locator('[data-secret-record="AUTH_CANARY"]').waitFor();
      assert.equal(new URL(page.url()).search, '');
      assert.equal(new URL(page.url()).hash, '#secrets');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  } finally {
    await h.close();
  }
});
