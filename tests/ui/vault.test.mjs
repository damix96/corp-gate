import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

const withHarness = async (setup, run) => {
  const h = new UiBrowserHarness();
  await h.init();
  if (setup) await setup(h);
  try {
    await h.open('/dashboard#secrets');
    await run(h);
    h.assertClean();
  } finally {
    await h.close();
  }
};

test('vault: pre-seeded records display, empty value handling, and search filtering', async () => withHarness(async h => {
  h.seedSecret('PRE_ALPHA', 'pre-secret-alpha', 'Alpha pre-seeded key', 1);
  h.seedSecret('PRE_EMPTY', '', 'Empty value secret', 1);
  h.seedSecret('PRE_OFF', 'gamma-secret', 'Initial off switch', 0);
}, async h => {
  const page = h.page;
  const rowAlpha = page.locator('[data-secret-record="PRE_ALPHA"]');
  const rowEmpty = page.locator('[data-secret-record="PRE_EMPTY"]');
  const rowOff = page.locator('[data-secret-record="PRE_OFF"]');
  await rowAlpha.waitFor({ state: 'visible' });
  await rowEmpty.waitFor({ state: 'visible' });
  await rowOff.waitFor({ state: 'visible' });
  await assert.match(await rowAlpha.innerText(), /pre-secret-alpha/);
  await assert.match(await rowAlpha.innerText(), /Alpha pre-seeded key/);
  await assert.match(await rowEmpty.innerText(), /\(пусто\)|\(empty\)/);
  await assert.match(await rowOff.innerText(), /\bOFF\b/);
  const search = page.getByPlaceholder(/Найти по имени|Search by name/);
  await search.fill('gamma-secret');
  await rowOff.waitFor({ state: 'visible' });
  await rowAlpha.waitFor({ state: 'detached' });
  await search.fill('not-found-query-xyz');
  await page.getByText(/Совпадений нет|No matches found/i).first().waitFor();
  await search.fill('');
  await rowAlpha.waitFor({ state: 'visible' });
}));

test('vault: edit existing pre-seeded record updates value and preserves read-only key', async () => withHarness(async h => {
  h.seedSecret('PRE_EXISTING', 'original-value-111', 'Original description', 1);
}, async h => {
  const page = h.page;
  const row = page.locator('[data-secret-record="PRE_EXISTING"]');
  await row.waitFor({ state: 'visible' });
  await row.locator('button[aria-label="Изменить"], button[aria-label="Edit"]').click();
  const modal = page.getByRole('dialog');
  await modal.waitFor({ state: 'visible' });
  await assert.match(await modal.innerText(), /Изменить секрет|Edit secret/i);
  const keyInput = modal.getByLabel(/Имя записи|Record name|Имя подстановки/i).first();
  assert.equal(await keyInput.getAttribute('readonly'), '');
  assert.equal(await keyInput.inputValue(), 'PRE_EXISTING');
  const valInput = modal.getByLabel(/Секретное значение|Secret value/i);
  await valInput.fill('updated-value-999');
  const descInput = modal.getByLabel(/Описание|Description/i);
  await descInput.fill('Updated description text');
  await modal.getByRole('button', { name: /Сохранить в Сейф|Save to Vault/i }).click();
  await modal.waitFor({ state: 'hidden' });
  await row.waitFor({ state: 'visible' });
  await assert.match(await row.innerText(), /updated-value-999/);
  await assert.match(await row.innerText(), /Updated description text/);
}));

test('vault: maskInAi switch toggles ON OFF and updates state', async () => withHarness(async h => {
  h.seedSecret('MASK_KEY', 'mask-me', 'mask test', 1);
}, async h => {
  const page = h.page;
  const row = page.locator('[data-secret-record="MASK_KEY"]');
  await row.waitFor({ state: 'visible' });
  await assert.match(await row.innerText(), /\bON\b/);
  const track = row.locator('.mantine-Switch-track');
  const toggleReq = page.waitForResponse(r => r.url().includes('/api/vault/secret/MASK_KEY/toggle') && r.request().method() === 'POST');
  await track.click();
  await toggleReq;
  await page.waitForFunction(() => document.querySelector('[data-secret-record="MASK_KEY"]')?.textContent?.includes('OFF'));
  const toggleReq2 = page.waitForResponse(r => r.url().includes('/api/vault/secret/MASK_KEY/toggle') && r.request().method() === 'POST');
  await track.click();
  await toggleReq2;
  await page.waitForFunction(() => document.querySelector('[data-secret-record="MASK_KEY"]')?.textContent?.includes('ON'));
}));

test('vault: action buttons are horizontally aligned and stay inside table', async () => withHarness(async h => {
  h.seedSecret('GEOM_KEY', 'geom-val', 'geom test', 1);
}, async h => {
  const page = h.page;
  const row = page.locator('[data-secret-record="GEOM_KEY"]');
  await row.waitFor({ state: 'visible' });
  const b1 = await row.locator('td').last().locator('button').first().boundingBox();
  const b2 = await row.locator('td').last().locator('button').last().boundingBox();
  const table = page.locator('table').first();
  const t = await table.boundingBox();
  assert.ok(b1 && b2 && t);
  assert.ok(Math.abs(b1.y - b2.y) < 2, `misaligned: ${b1.y} vs ${b2.y}`);
  assert.ok(b2.x + b2.width <= t.x + t.width, `overflow: ${b2.x + b2.width} > ${t.x + t.width}`);
}));

test('vault: delete pre-seeded secret with confirm dialog', async () => withHarness(async h => {
  h.seedSecret('DELETE_KEY', 'del-val', 'delete test', 1);
}, async h => {
  const page = h.page;
  const row = page.locator('[data-secret-record="DELETE_KEY"]');
  await row.waitFor({ state: 'visible' });
  await row.locator('button[aria-label="Удалить"], button[aria-label="Delete"]').click();
  const confirm = page.getByRole('dialog').last();
  await confirm.waitFor({ state: 'visible' });
  await assert.match(await confirm.innerText(), /Удалить секрет|Delete secret/i);
  await confirm.getByRole('button', { name: /Delete|Удалить/ }).click();
  await row.waitFor({ state: 'detached' });
}));
