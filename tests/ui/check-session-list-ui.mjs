import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = process.env.CG_UI_EVIDENCE_DIR || '../../.codex/reports/session-summary-legacy-interaction-20261113-evidence';
await mkdir(output, { recursive: true });
const alias = '$${<LIST_HOST>}', rep = '$${<LIST_HOST__GV_URL_1>}', unknown = '$${<LIST_UNKNOWN>}', missingRep = '$${<LIST_HOST__GV_NOT_SAVED>}', empty = '$${<LIST_EMPTY>}', hidden = '$${<LIST_HIDDEN>}';
const body = { system: 'Настройка ' + alias, messages: [{ role: 'user', content: `Первый запрос: ${alias} и ${alias}. Ссылка ${rep}, неизвестное ${unknown}, пустое ${empty}, скрытое ${hidden}` }, { role: 'assistant', content: 'Первый ответ ' + alias, tool_calls: [{ function: { arguments: JSON.stringify({ url: rep }) } }] }, { role: 'user', content: `Второй запрос:\n    host = ${alias}\nСравни ${unknown} и ${missingRep}` }] };
const after = 'Ответ: 192.0.2.20 и 192.0.2.20';
const evidence = [...after.matchAll(/192\.0\.2\.20/g)].map((match, i) => ({ id: String(i), key: 'LIST_HOST', alias, value: '192.0.2.20', source: 'response-field', fieldId: 'response.text', after: { text: after, start: match.index, end: match.index + 10, contextStart: 0, totalLength: after.length } }));
const records = [{ key: 'LIST_HOST', alias, realValue: '192.0.2.20', representations: [{ alias: rep, value: '192%2E0%2E2%2E20', format: 'urlEncoded' }] }, { key: 'LIST_EMPTY', alias: empty, realValue: '' }, { key: 'LIST_HIDDEN', alias: hidden, realValue: 'NEVER_VISIBLE_HIDDEN_VALUE', valueHidden: true }];
const step = { timestamp: '2026-11-13T00:00:00.000Z', state: 'complete', maskedPrompt: JSON.stringify(body), request: { body: alias.repeat(11) }, interceptedSecrets: records, response: { status: 200, body: alias.repeat(7) + ' $${<RESPONSE_ONLY>}' }, responseChanges: { version: 1, status: 'complete', items: evidence } };
const expected = { [alias]: 5, [rep]: 2, [unknown]: 2, [empty]: 1, [hidden]: 1, [missingRep]: 1 };
let current = step;
const errors = [], writes = [], results = [];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { globalThis.__listCopy = value; }, readText: async () => globalThis.__listCopy } }));
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') writes.push(route.request().method());
  const path = new URL(route.request().url()).pathname;
  const data = path === '/api/routes' ? [{ id: 'list', prefix: 'list', name: 'Безопасный пример', incomingUrl: 'http://127.0.0.1:8767/list', upstreamUrl: 'https://example.invalid' }]
    : path === '/api/workspace' ? { visible: ['list'], selected: 'list' }
      : path === '/api/sessions' ? [{ id: 'list-demo', client: 'Пример списка', endpoint: '/list/v1/chat/completions', lastSeen: step.timestamp }]
        : path.startsWith('/api/sessions/') ? [current]
          : path === '/api/vault' ? { manualSecrets: [], autoSecrets: records.map(record => ({ ...record, hitCount: 1 })) }
            : path === '/api/patterns' ? [] : {};
  await route.fulfill({ status: 200, contentType: path === '/api/events' ? 'text/event-stream' : 'application/json', body: path === '/api/events' ? ': synthetic\n\n' : JSON.stringify(data) });
});
const panel = page.getByRole('region', { name: 'Подстановки в запросе', exact: true });
const row = value => panel.locator('[data-substitution-alias=' + JSON.stringify(value) + ']');
const counts = () => panel.locator('[data-substitution-alias]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.getAttribute('data-substitution-alias'), Number(node.querySelector('[data-substitution-count]').textContent)])));
const dialog = page.getByRole('dialog');
const trigger = value => row(value).getByRole('button').first();
const dismiss = async () => { await page.mouse.move(1000,210); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); };
const hint = async (value, interaction = 'click') => { if (await dialog.count()) await dismiss(); const control = trigger(value); if (interaction === 'hover') { await page.mouse.move(1000,210); await control.hover(); } else if (interaction === 'focus') { await page.keyboard.press('Tab'); await control.focus(); } else await control.click(); await page.waitForFunction(()=>document.querySelectorAll('[role=dialog]').length===1); await dialog.waitFor(); return control; };
const reload = async value => { current = value; await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-session-inspector][aria-busy="false"]').waitFor(); };
const check = async (name, run) => { await run(); results.push({ name, status: 'PASS' }); };
try {
 await page.goto(process.env.CG_UI_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' }); await panel.waitFor();
 await check('compact-top-chips-counts-no-disclosures-or-text-actions', async () => {
  assert.deepEqual(await counts(), expected); assert.equal(await panel.locator('[data-substitution-total]').innerText(), '6'); assert.equal(await panel.locator('.mantine-Accordion-root, details, [data-accordion-control]').count(), 0);
  const layout = await panel.locator('[data-substitution-alias]').evaluateAll(nodes => nodes.map(node => { const rect = node.querySelector('button').getBoundingClientRect(), badge = node.querySelector('[data-substitution-count]').getBoundingClientRect(); return { y: Math.round(rect.y), height: rect.height, fits: badge.right <= rect.right && badge.x >= rect.x }; }));
  assert.equal(new Set(layout.map(item => item.y)).size, 2); assert.ok(layout.every(item => item.height === 36 && item.fits)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.mouse.move(750, 210); await page.screenshot({ path: output + '/after-simple-chips.png' });
 });
 await check('Escape-closes-hover-hint-with-pointer-on-trigger',async()=>{await hint(rep,'hover');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});});
 await check('hover-hint-copy-icons-exact-representation-no-layout-shift', async () => {
  const before = await panel.boundingBox(); await hint(rep, 'hover'); assert.equal(await dialog.getByRole('textbox', { name: 'Ушло', exact: true }).inputValue(), rep); assert.equal(await dialog.getByRole('textbox', { name: 'Было', exact: true }).inputValue(), '192%2E0%2E2%2E20'); assert.deepEqual(await panel.boundingBox(), before);
  await dialog.getByRole('button', { name: 'Копировать исходное значение LIST_HOST', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '192%2E0%2E2%2E20'); await dialog.getByRole('button', { name: 'Копировать подстановку', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), rep);
  assert.ok((await dialog.getByRole('button').allTextContents()).every(text => text.trim() === '')); await page.screenshot({ path: output + '/after-hint-RU.png' }); await dismiss();
 });
 await check('copy-icon-Escape-restores-exact-summary-and-inline-trigger-then-Tab', async () => {
  for (const scope of ['summary', 'inline']) {
   if (await dialog.count()) await dismiss(); await page.mouse.move(1000,210);
   const control = scope === 'summary' ? trigger(rep) : page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + rep, exact: true }).first();
   if (scope === 'summary') await control.hover(); else await control.click(); await dialog.waitFor();
   await dialog.getByRole('button', { name: 'Копировать исходное значение LIST_HOST', exact: true }).click();
   assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true); const beforeY = await page.evaluate(() => scrollY);
   await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   assert.equal(await control.evaluate(node => node === document.activeElement), true); assert.equal(await control.getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => scrollY), beforeY);
   await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'BODY'), false);
   if (await dialog.count()) await dismiss();
  }
 });
 await check('outside-search-focus-survives-rehover-Escape-after-copy', async () => {
  await hint(rep); await dialog.getByRole('button', { name: 'Копировать исходное значение LIST_HOST', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Поиск сессий', exact: true }); await search.click(); await dialog.waitFor({ state: 'hidden' }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await search.evaluate(node => node === document.activeElement), true);
  await trigger(rep).hover(); await dialog.waitFor(); assert.equal(await search.evaluate(node => node === document.activeElement), true); const beforeY = await page.evaluate(() => scrollY);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await search.evaluate(node => node === document.activeElement), true); assert.equal(await trigger(rep).getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => scrollY), beforeY);
 });
 await check('focus-enter-pin-escape-retains-focus-and-next-control', async () => {
  const control = await hint(alias, 'focus'); await page.keyboard.press('Enter'); await page.mouse.move(1000, 200); assert.equal(await control.getAttribute('aria-expanded'), 'true'); await dismiss(); assert.equal(await control.evaluate(node => node === document.activeElement), true); await page.keyboard.press('Tab'); assert.equal(await trigger(rep).evaluate(node=>node===document.activeElement),true); await dialog.waitFor(); await dismiss();
 });
 await check('unknown-and-missing-representation-token-only-copy-no-navigation', async () => {
  for (const value of [unknown, missingRep]) { const control = await hint(value); assert.equal(await control.getAttribute('data-secret-key'), null); assert.equal(await dialog.getByRole('textbox', { name: 'Было', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: /Копировать исходное/ }).count(), 0); await dialog.getByRole('button', { name: 'Копировать подстановку', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), value); await dismiss(); }
 });
 await check('hidden-value-never-copied-empty-value-copies-empty-string', async () => {
  await hint(hidden); assert.equal(await dialog.getByRole('textbox', { name: 'Было', exact: true }).inputValue(), 'Значение скрыто'); assert.equal(await dialog.getByRole('button', { name: /Копировать исходное/ }).count(), 0); assert.ok(!(await page.locator('textarea').evaluateAll(nodes => nodes.map(node => node.value).join(' '))).includes('NEVER_VISIBLE_HIDDEN_VALUE')); await dismiss();
  await hint(empty); assert.equal(await dialog.getByRole('textbox', { name: 'Было', exact: true }).inputValue(), '(пустая строка)'); await dialog.getByRole('button', { name: 'Копировать исходное значение LIST_EMPTY', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), ''); await dismiss();
 });
 await check('RU-EN-localized-copy-icons-and-counts', async () => {
  await page.getByRole('button', { name: 'EN', exact: true }).click(); const enPanel = page.getByRole('region', { name: 'Substitutions in request', exact: true }); await enPanel.waitFor(); await enPanel.locator('[data-substitution-alias=' + JSON.stringify(rep) + ']').getByRole('button').first().click(); await dialog.waitFor(); await dialog.getByRole('button', { name: 'Copy original value LIST_HOST', exact: true }).waitFor(); assert.ok((await dialog.getByRole('button').allTextContents()).every(text => text.trim() === '')); await page.screenshot({ path: output + '/after-hint-EN.png' }); await dismiss(); await page.getByRole('button', { name: 'RU', exact: true }).click(); assert.deepEqual(await counts(), expected);
 });
 await check('Ctrl-click-and-Ctrl-Enter-navigate-known-base-record', async () => {
  await trigger(alias).click({ modifiers: ['Control'] }); await page.getByRole('tab', { name: 'Правила', exact: true, selected: true }).waitFor(); await page.locator('[data-secret-record="LIST_HOST"]').waitFor(); await page.getByRole('tab', { name: 'Обзор', exact: true }).click(); await panel.waitFor(); await trigger(rep).focus(); await page.keyboard.press('Control+Enter'); await page.getByRole('tab', { name: 'Правила', exact: true, selected: true }).waitFor(); await page.locator('[data-secret-record="LIST_HOST"]').waitFor(); await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
 });
 await check('Simple-Advanced-full-json-and-both-complete-orders', async () => {
  await page.getByText('Расширенный', { exact: true }).click(); await page.getByText('Полный текст', { exact: true }).click(); assert.deepEqual(await counts(), expected); await page.getByText('JSON / HTTP', { exact: true }).click(); assert.deepEqual(await counts(), expected); await page.getByText('Простой', { exact: true }).click();
  for (const newest of [false, true]) { await page.getByRole('textbox', { name: 'Порядок сообщений', exact: true }).click(); await page.getByRole('option', { name: newest ? 'Последние сверху' : 'Последние снизу', exact: true }).click(); const sequence = await page.locator('[data-occurrence-side]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-side') + node.closest('[data-session-turn]').getAttribute('data-session-turn'))); assert.deepEqual(sequence, newest ? ['response2', 'request2', 'response1', 'request1'] : ['request1', 'response1', 'request2', 'response2']); }
 });
 await check('saved-empty-missing-and-pending', async () => {
  await reload({ ...step, maskedPrompt: { messages: [] } }); assert.equal(await panel.locator('[data-substitution-total]').innerText(), '0'); await reload({ ...step, maskedPrompt: undefined }); assert.equal(await panel.locator('[data-substitution-total]').innerText(), '—'); await reload({ ...step, state: 'active', response: undefined, responseChanges: { version: 1, status: 'pending', items: [] } }); assert.deepEqual(await counts(), expected); await page.getByText('Ответ поступает', { exact: true }).waitFor();
 });
 await check('serialized-value-counts-not-property-names', async () => {
  await reload({ ...step, maskedPrompt: { messages: [{ role: 'user', content: 'Safe' }, { role: 'assistant', tool_calls: [{ function: { arguments: '{"value":"\\u0024\\u0024{<LIST_HOST>}","$${<LIST_UNKNOWN>}":"plain"}' } }] }] } }); assert.deepEqual(await counts(), { [alias]: 1 });
 });
 await check('two-rows-sorted-ties-Showmore-collapse-long-alias-actions', async () => {
  const many = Array.from({ length: 13 }, (_, index) => ({ alias: '$${<SUMMARY_' + String(index).padStart(2, '0') + (index % 2 ? '_LONG_ALIAS'.repeat(12) : '') + '>}', count: 13 - Math.floor(index / 2) })); const sorted = [...many].sort((a, b) => b.count - a.count || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)); await reload({ ...step, maskedPrompt: { messages: [{ role: 'user', content: [...many].reverse().map(item => Array(item.count).fill(item.alias).join(' ')).join('\n') }] }, interceptedSecrets: [] });
  const items = panel.locator('[data-substitution-alias]'); assert.deepEqual(await items.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-substitution-alias'))), sorted.slice(0, 6).map(item => item.alias)); const bounds = await items.evaluateAll(nodes => nodes.map(node => { const rect = node.querySelector('button').getBoundingClientRect(), badge = node.querySelector('[data-substitution-count]').getBoundingClientRect(); return { y: Math.round(rect.y), h: rect.height, fits: badge.right <= rect.right && badge.x >= rect.x }; })); assert.equal(new Set(bounds.map(item => item.y)).size, 2); assert.ok(bounds.every(item => item.h === 36 && item.fits)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.mouse.move(800, 210); await page.screenshot({ path: output + '/two-rows.png' });
  await panel.getByRole('button', { name: 'Показать ещё', exact: true }).click(); assert.deepEqual(await counts(), Object.fromEntries(sorted.map(item => [item.alias, item.count]))); const last = sorted.at(-1); await hint(last.alias); assert.equal(await dialog.getByRole('textbox', { name: 'Ушло', exact: true }).inputValue(), last.alias); await dismiss(); await panel.getByRole('button', { name: 'Свернуть', exact: true }).click(); assert.equal(await items.count(), 6);
 });
 assert.deepEqual(errors, []); assert.deepEqual(writes, []); console.log(`PASS summary chip interaction ${results.length} desktop checks; errors0/writes0`);
} catch (error) { errors.push(error.message); await page.screenshot({ path: output + '/failure-safe.png' }); throw error; }
finally { await browser.close(); await writeFile(output + '/list-checks.json', JSON.stringify({ results, errors, writes, viewport: { width: 1440, height: 1000 }, closed: true }, null, 2)); }