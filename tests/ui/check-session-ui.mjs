import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = process.env.CG_UI_EVIDENCE_DIR || '../../.codex/reports/session-occurrences-layout-fix-20261112-evidence';
await mkdir(output, { recursive: true });
const alias = '$${<DEMO_IP>}';
const rep = '$${<DEMO_IP__GV_URL_1>}';
const unknown = '$${<UNKNOWN_DEMO>}';
const body = { system: 'Проверяй адрес ' + alias, messages: [
  { role: 'user', content: 'Сгенерируй пример для ' + alias + ', затем повтори ' + alias + '.' },
  { role: 'assistant', tool_calls: [{ function: { name: 'lookup', arguments: JSON.stringify({ host: alias, repeated: rep }) } }] },
  { role: 'user', content: [{ type: 'tool_result', content: 'Проверен адрес ' + alias }] },
  { role: 'assistant', content: 'Ссылка: ' + rep },
  { role: 'user', content: 'Начало полного текста. ' + 'Обычный текст без вхождений. '.repeat(90) + '\nСравни ' + alias + ' и ' + unknown + '\nКонец полного текста.' },
  { role: 'tool', content: Array.from({ length: 18 }, (_, i) => ({ text: `Результат проверки ${i + 1}: ${alias}` })) },
] };
const text = 'Адрес 192.0.2.10 повторён: 192.0.2.10';
const before = 'Адрес ' + alias + ' повторён: ' + alias;
const items = [0, 1].map((i) => ({ id: 'demo-' + i, source: 'response-field', fieldId: 'response.content[0].text', key: 'DEMO_IP', alias, value: '192.0.2.10', before: { text: before, start: i ? before.lastIndexOf(alias) : before.indexOf(alias), end: (i ? before.lastIndexOf(alias) : before.indexOf(alias)) + alias.length, contextStart: 0, totalLength: before.length }, after: { text, start: i ? text.lastIndexOf('192.0.2.10') : text.indexOf('192.0.2.10'), end: (i ? text.lastIndexOf('192.0.2.10') : text.indexOf('192.0.2.10')) + 10, contextStart: 0, totalLength: text.length } }));
const step = { timestamp: '2026-11-12T00:00:00.000Z', sessionId: 'desktop-demo-a', state: 'complete', request: { body, headers: { authorization: 'Bearer DEMO_CREDENTIAL_MUST_HIDE' } }, maskedPrompt: JSON.stringify(body), interceptedSecrets: [{ key: 'DEMO_IP', alias, realValue: '192.0.2.10', representations: [{ alias: rep, value: '192%2E0%2E2%2E10', format: 'urlEncoded' }] }], response: { status: 200, body: { content: [{ type: 'text', text }] } }, responseChanges: { version: 1, status: 'complete', items } };
let current = step;
const errors = [];
const writes = [];
const results = [];
const check = async (name, run) => { await run(); results.push({ name, status: 'PASS' }); };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**/api/**', async route => {
  const request = route.request();
  if (request.method() !== 'GET') writes.push(request.method());
  const path = new URL(request.url()).pathname;
  const data = path === '/api/routes' ? [{ id: 'demo', prefix: 'demo', name: 'Безопасный пример', upstreamUrl: 'https://example.invalid', incomingUrl: 'http://127.0.0.1:8767/demo' }]
    : path === '/api/workspace' ? { selected: 'demo', visible: ['demo'] }
      : path === '/api/sessions' ? ['a', 'b'].map(id => ({ id: 'desktop-demo-' + id, client: 'Безопасная сессия', endpoint: '/demo/v1/chat/completions', lastSeen: step.timestamp }))
        : path.startsWith('/api/sessions/') ? [{ ...current, sessionId: path.split('/').at(-1) }]
          : path === '/api/vault' ? { manualSecrets: [], autoSecrets: ['AUTO_IP_1', 'AUTO_IP_2', 'AUTO_URL_1', 'AUTO_URL_2'].map((key, i) => ({ key, alias: '$${<' + key + '>}', realValue: 'demo-' + i, hitCount: i })) }
            : path === '/api/patterns' ? [] : {};
  await route.fulfill({ status: 200, contentType: path === '/api/events' ? 'text/event-stream' : 'application/json', body: path === '/api/events' ? ': synthetic\n\n' : JSON.stringify(data) });
});
const reload = async value => { current = value; await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-session-inspector="occurrences-v2"]').waitFor(); };
try {
  await page.goto(process.env.CG_UI_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-session-inspector="occurrences-v2"]').waitFor();
  await check('simple-default-all-occurrences-visible-without-spoilers', async () => {
    assert.equal(await page.getByText('Какой этап показать', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Места замен', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Полный текст', { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-session-turn]').count(), 2);
    assert.equal(await page.locator('[data-session-content] .mantine-Accordion-root').count(), 0);
    assert.equal(await page.locator('[data-session-inspector] .mantine-Spoiler-root').count(), 0);
    assert.equal(await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + alias, exact: true }).count(), 24);
    assert.equal(await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + rep, exact: true }).count(), 2);
    assert.equal(await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + unknown, exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Восстановление ' + alias, exact: true }).count(), 2);
    assert.ok(!(await page.locator('[data-session-inspector]').innerText()).includes('Начало полного текста.'));
    const tools = page.locator('[data-session-turn="1"] [data-occurrence-side="response"]');
    assert.equal(await tools.getByRole('button', { name: 'Подстановка ' + alias, exact: true }).count(), 2);
    assert.equal(await page.locator('[data-occurrence-side="request"]').last().getByRole('button', { name: 'Подстановка ' + alias, exact: true }).count(), 3);
    await page.screenshot({ path: output + '/after-synthetic-default.png' });
  });
  await check('page-scroll-no-central-vertical-viewport', async () => {
    const measured = await page.locator('[data-session-inspector]').evaluate(root => ({ height: root.getBoundingClientRect().height, nested: [...root.querySelectorAll('*')].filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).map(node => node.className) }));
    assert.ok(measured.height > 1000, JSON.stringify(measured));
    assert.deepEqual(measured.nested, []);
    await page.mouse.move(950, 780); await page.mouse.wheel(0, 1000);
    await page.waitForFunction(() => window.scrollY > 0);
    await page.screenshot({ path: output + '/after-synthetic-page-scroll.png' });
  });
  await check('chip-keyboard-exact-representation-unknown', async () => {
    const chip = page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + rep, exact: true }).first();
    await chip.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('textbox', { name: 'Было', exact: true }).inputValue(), '192%2E0%2E2%2E10');
    await page.keyboard.press('Escape'); assert.equal(await chip.getAttribute('aria-expanded'), 'false');
    await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + unknown, exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /^Копировать исходное значение / }).count(), 0);
    await page.keyboard.press('Escape');
  });
  await check('advanced-full-explicit-simple-restores-occurrences', async () => {
    await page.getByText('Расширенный', { exact: true }).click();
    await page.getByText('Полный текст', { exact: true }).click();
    assert.ok((await page.locator('[data-session-inspector]').innerText()).includes('Начало полного текста.'));
    assert.ok((await page.locator('[data-session-inspector]').innerText()).includes('Конец полного текста.'));
    assert.equal(await page.locator('[data-session-inspector] .mantine-Spoiler-root').count(), 0);
    await page.screenshot({ path: output + '/after-synthetic-full.png' });
    await page.getByText('Простой', { exact: true }).click();
    assert.ok(!(await page.locator('[data-session-inspector]').innerText()).includes('Начало полного текста.'));
    await page.getByText('Расширенный', { exact: true }).click();
    assert.ok((await page.locator('[data-session-inspector]').innerText()).includes('Начало полного текста.'));
  });
  await check('technical-credential-hidden', async () => {
    await page.getByText('JSON / HTTP', { exact: true }).click();
    await page.getByRole('button', { name: 'Сохранённый HTTP-запрос', exact: true }).click();
    assert.ok(!(await page.getByRole('textbox', { name: 'Сохранённый HTTP-запрос', exact: true }).inputValue()).includes('DEMO_CREDENTIAL_MUST_HIDE'));
    await page.getByText('Места замен', { exact: true }).click();
  });
  await check('interrupted-hidden-empty-invalid-protocol-visible', async () => {
    const extra = (id, value, hidden = false) => ({ ...items[0], id, fieldId: id, value, valueHidden: hidden, after: { text: value, start: 0, end: value.length, contextStart: 0, totalLength: value.length } });
    await reload({ ...step, responseChanges: { version: 1, status: 'interrupted', postHookModified: true, items: [...items, extra('empty', ''), extra('hidden', '[protected]', true), { ...extra('protocol', '192.0.2.10'), source: 'protocol-snapshot' }, { ...extra('invalid', 'wrong'), after: { text: 'wrong', start: 40, end: 41 } }] } });
    assert.equal(await page.getByRole('button', { name: 'Восстановление ' + alias, exact: true }).count(), 5);
    await page.getByText('В данных протокола', { exact: true }).waitFor();
    await page.getByText('Фрагменты с некорректными диапазонами не показаны: 1.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-session-content] .mantine-Accordion-root').count(), 0);
    await page.getByText('Фрагменты с некорректными диапазонами не показаны: 1.', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/after-synthetic-states.png' });
    const chips = page.getByRole('button', { name: 'Восстановление ' + alias, exact: true });
    await chips.filter({ hasText: 'Значение скрыто' }).click();
    assert.equal(await page.getByRole('button', { name: /^Копировать исходное значение / }).count(), 0);
    await page.keyboard.press('Escape');
    await chips.filter({ hasText: '(пустая строка)' }).click();
    assert.equal(await page.getByRole('button', { name: /^Копировать исходное значение / }).count(), 1);
    await page.keyboard.press('Escape');
  });
  await check('pending-unbound-no-false-turn', async () => {
    await reload({ ...step, maskedPrompt: JSON.stringify({ system: alias }), response: undefined, state: 'active', responseChanges: { version: 1, status: 'pending', items: [] } });
    assert.equal(await page.locator('[data-session-turn="unbound"]').count(), 1);
    assert.equal(await page.getByText('Ответ поступает', { exact: true }).count(), 1);
    assert.equal(await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + alias, exact: true }).count(), 1);
  });
  await check('missing-request-not-reconstructed', async () => {
    await reload({ ...step, maskedPrompt: undefined });
    assert.equal(await page.locator('[data-session-turn="unbound"]').count(), 1);
    assert.equal(await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + alias, exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Восстановление ' + alias, exact: true }).count(), 2);
  });
  await check('RU-EN-mode-preserved', async () => {
    await reload(step); await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.getByText('Request 2', { exact: true }).waitFor();
    await page.getByText('Response 2', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'RU', exact: true }).click();
  });
  await check('top-level-array-turn-placement', async () => {
    await reload({ ...step, maskedPrompt: JSON.stringify([{ role: 'user', content: 'ARRAY_USER_1 ' + alias }, { role: 'tool', content: 'ARRAY_TOOL ' + alias }, { role: 'user', content: 'ARRAY_USER_2 ' + alias }]) });
    const first = page.locator('[data-session-turn="1"]');
    const second = page.locator('[data-session-turn="2"]');
    assert.ok((await first.locator('[data-occurrence-side="request"]').innerText()).includes('ARRAY_USER_1'));
    assert.ok((await first.locator('[data-occurrence-side="response"]').innerText()).includes('ARRAY_TOOL'));
    assert.ok((await second.locator('[data-occurrence-side="request"]').innerText()).includes('ARRAY_USER_2'));
    assert.ok(!(await first.locator('[data-occurrence-side="request"]').innerText()).includes('ARRAY_USER_2'));
    await page.screenshot({ path: output + '/after-array-turn-placement.png', fullPage: true });
  });
  await check('full-Unicode-long-unbroken-copyable-without-clipping', async () => {
    const long = 'Начало 😀\r\n' + 'абв😀'.repeat(100) + '\n' + alias + '\nКОНЕЦ_ПОЛНОГО_ТЕКСТА';
    await reload({ ...step, maskedPrompt: JSON.stringify({ messages: [{ role: 'user', content: long }] }) });
    await page.getByText('Полный текст', { exact: true }).click();
    const field = page.locator('[data-occurrence-field="request.messages[0].content"]');
    assert.ok((await field.innerText()).includes('КОНЕЦ_ПОЛНОГО_ТЕКСТА'));
    assert.ok((await field.textContent()).includes('абв😀'.repeat(100)));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('[data-session-inspector] .mantine-Spoiler-root').count(), 0);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/after-synthetic-Unicode.png' });
    await page.getByText('Места замен', { exact: true }).click();
  });
  await check('table-groups-retained', async () => {
    await page.getByRole('tab', { name: 'Правила', exact: true }).click();
    await page.getByRole('tab', { name: /Обнаруженные данные/ }).click();
    const group = page.getByRole('button', { name: 'Группа AUTO_IP', exact: true });
    assert.equal(await group.getAttribute('aria-expanded'), 'false');
    await group.focus(); await page.keyboard.press('Enter');
    assert.equal(await group.getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: 'Группа AUTO_URL', exact: true }).click();
    await page.screenshot({ path: output + '/after-synthetic-table.png' });
    await group.focus(); await page.keyboard.press('Space');
    assert.equal(await group.getAttribute('aria-expanded'), 'false');
  });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS desktop occurrence UI: ' + results.length + ' cases; no real API writes or mobile checks');
} catch (error) {
  errors.push(error.message); await page.screenshot({ path: output + '/failure-synthetic.png' }); throw error;
} finally {
  await browser.close(); await writeFile(output + '/owner-checks.json', JSON.stringify({ results, errors, writes, viewport: { width: 1440, height: 1000 }, closed: true }, null, 2));
}
