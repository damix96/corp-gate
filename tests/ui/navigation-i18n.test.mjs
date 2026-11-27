import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

describe('navigation and i18n', () => {
  const harness = new UiBrowserHarness();
  before(async () => { await harness.init(); await harness.open('/dashboard#overview'); });
  after(async () => harness.close());

  test('header contains strictly 3 primary tabs and no phantom views', async () => {
    const page = harness.page;
    const headerTabs = page.locator('header [role="tab"]');
    await headerTabs.first().waitFor({ state: 'visible' });
    assert.equal(await headerTabs.count(), 3);
    const phantom = page.locator('button, a, [role="tab"]').filter({ hasText: /Feed|Inspector|Диагностика|События/i });
    assert.equal(await phantom.count(), 0);
    const brand = page.locator('header').getByText('CorpGate').first();
    await brand.waitFor({ state: 'visible' });
    assert.match(await page.title(), /CorpGate/);
    harness.assertClean();
  });

  test('tabs navigate and update location.hash including vault alias and fallback', async () => {
    const page = harness.page;
    await page.getByRole('tab', { name: /Vault|Сейф/ }).click();
    await page.waitForFunction(() => location.hash === '#secrets');
    await page.getByRole('tab', { name: /Rules|Правила/ }).click();
    await page.waitForFunction(() => location.hash === '#rules');
    await page.getByRole('tab', { name: /Overview|Обзор/ }).click();
    await page.waitForFunction(() => location.hash === '#overview');
    await page.evaluate(() => { location.hash = '#vault'; });
    await page.waitForFunction(() => document.querySelector('header [role="tab"][aria-selected="true"]')?.textContent?.match(/Vault|Сейф/));
    await page.evaluate(() => { location.hash = '#unknown-route'; });
    await page.waitForFunction(() => location.hash === '#overview');
    harness.assertClean();
  });

  test('simple and advanced mode toggle persists in localStorage', async () => {
    const page = harness.page;
    const advanced = page.locator('label').filter({ hasText: /Advanced|Расширенный/ }).first();
    const simple = page.locator('label').filter({ hasText: /Simple|Простой/ }).first();
    await advanced.click();
    await page.waitForFunction(() => localStorage.getItem('corpgate.interface-mode') === 'advanced');
    await simple.click();
    await page.waitForFunction(() => localStorage.getItem('corpgate.interface-mode') === 'simple');
    harness.assertClean();
  });

  test('export modal opens with sections and closes', async () => {
    const page = harness.page;
    await page.getByRole('button', { name: /Export|Экспорт/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await assert.match(await dialog.innerText(), /Export Settings|Экспорт настроек/);
    const checkboxes = dialog.getByRole('checkbox');
    assert.ok((await checkboxes.count()) >= 4);
    await dialog.getByRole('button', { name: /Close|Закрыть/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    harness.assertClean();
  });

  test('RU EN language switch preserves search input and keeps controls clickable', async () => {
    const page = harness.page;
    await page.getByRole('tab', { name: /Vault|Сейф/ }).click();
    await page.waitForFunction(() => location.hash === '#secrets');
    const search = page.getByPlaceholder(/Найти по имени|Search by name/);
    await search.fill('alpha-secret');
    const lang = page.getByRole('button', { name: /^(RU|EN)$/ });
    const beforeText = await lang.innerText();
    await lang.click();
    await page.waitForFunction(prev => Array.from(document.querySelectorAll('button')).some(b => /^(RU|EN)$/.test((b.textContent || '').trim()) && (b.textContent || '').trim() !== prev), beforeText.trim());
    assert.equal(await search.inputValue(), 'alpha-secret');
    await search.click();
    const afterLang = page.getByRole('button', { name: /^(RU|EN)$/ });
    await afterLang.click();
    await page.waitForFunction(prev => Array.from(document.querySelectorAll('button')).some(b => (b.textContent || '').trim() === prev), beforeText.trim());
    harness.assertClean();
  });
});
