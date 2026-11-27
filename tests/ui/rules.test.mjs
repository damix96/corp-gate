import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

const tx = (id, body) => ({ id, session_id: 's1', timestamp: new Date().toISOString(), latency_ms: 10, method: 'POST', url: '/anthropic/v1/messages', client: 'cli', prompt_text: JSON.stringify(body), model_response: '{"ok":true}', masked_prompt: JSON.stringify(body), intercepted_secrets: '[]', target_url: 'https://api.anthropic.com', target_provider: 'anthropic', status: 200 });

const withHarness = async (setup, run) => {
  const h = new UiBrowserHarness();
  await h.init();
  if (setup) await setup(h);
  try {
    await run(h);
    h.assertClean();
  } finally {
    await h.close();
  }
};

test('rules: pre-seeded pattern display, toggle and edit existing pattern', async () => withHarness(async h => {
  h.seedPattern('pat_pre1', 'internal-urls', 'https?://[a-z0-9.-]+\\.internal/[^\\s]+', 'url', 'INTERNAL_${host}', 1);
  h.seedPattern('pat_pre2', 'custom-key', 'my-token-\\d+', 'custom', null, 1);
}, async h => {
  await h.open('/dashboard#rules');
  await h.page.getByText(/Внутренние адреса|Internal URLs/i).first().waitFor();
  const cardCustom = h.page.locator('.mantine-Card-root', { hasText: 'custom-key' });
  await cardCustom.waitFor({ state: 'visible' });
  await cardCustom.getByRole('button', { name: /Изменить|Edit/i }).first().click();
  const modal = h.page.getByRole('dialog');
  await modal.waitFor({ state: 'visible' });
  await assert.match(await modal.innerText(), /Изменить правило|Edit rule/i);
  const regexInput = modal.locator('textarea').first();
  await regexInput.fill('my-token-[a-z0-9]+');
  await modal.getByRole('button', { name: /^(Сохранить|Save)$/i }).click();
  await modal.waitFor({ state: 'hidden' });
  await cardCustom.locator('.mantine-Accordion-control').click();
  await cardCustom.getByText('my-token-[a-z0-9]+').waitFor({ state: 'visible' });
}));

test('rules: subtab switching, click, and add rule button visibility invariant', async () => withHarness(null, async h => {
  await h.open('/dashboard#rules');
  const addBtn = h.page.getByRole('button', { name: /Добавить правило|Add rule/i });
  await addBtn.waitFor({ state: 'visible' });
  const detectionsTab = h.page.getByRole('tab', { name: /Обнаруженные|Detected/i });
  await detectionsTab.click();
  await addBtn.waitFor({ state: 'detached' });
  const rulesTab = h.page.getByRole('tab', { name: /Шаблоны|Search Patterns/i });
  await rulesTab.click();
  await addBtn.waitFor({ state: 'visible' });
}));

test('rules: live preview finds session match', async () => withHarness(async h => {
  h.seedTransaction(tx('tx1', { messages: [{ role: 'user', content: 'token secret-key-9911 here' }] }));
}, async h => {
  await h.open('/dashboard#rules');
  await h.page.getByRole('button', { name: /Добавить правило|Add rule/i }).click();
  const dialog = h.page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('textarea').first().fill('secret-key-\\d+');
  await dialog.getByText('secret-key-9911').first().waitFor();
  await dialog.locator('button.mantine-Modal-close').click();
  await dialog.waitFor({ state: 'hidden' });
}));

test('rules: detections grouped, aligned and promote to vault', async () => withHarness(async h => {
  h.seedAutoSecret('API_KEY_A', 'val-a', 2);
  h.seedAutoSecret('API_KEY_B', 'val-b', 3);
  h.seedAutoSecret('OTHER_X', 'val-x', 1);
}, async h => {
  await h.open('/dashboard#rules');
  await h.page.getByRole('tab', { name: /Обнаруженные данные|Detected data/i }).click();
  await h.page.getByText('API_KEY', { exact: true }).first().waitFor();
  await h.page.locator('[data-detection-group="API_KEY"] button').click();
  const rowA = h.page.locator('[data-secret-record="API_KEY_A"]');
  const rowB = h.page.locator('[data-secret-record="API_KEY_B"]');
  await rowA.waitFor();
  await rowB.waitFor();
  const b1 = await rowA.locator('td').last().locator('button').first().boundingBox();
  const b2 = await rowA.locator('td').last().locator('button').last().boundingBox();
  const table = h.page.locator('table').last();
  const t = await table.boundingBox();
  assert.ok(b1 && b2 && t);
  assert.ok(Math.abs(b1.y - b2.y) < 2);
  assert.ok(b2.x + b2.width <= t.x + t.width);
  await rowA.locator('td').last().locator('button').first().click();
  await rowA.waitFor({ state: 'detached' });
  await h.open('/dashboard#secrets');
  await h.page.locator('[data-secret-record="API_KEY_A"]').waitFor();
}));
