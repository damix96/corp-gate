import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = process.env.CG_UI_EVIDENCE_DIR || '../../.codex/reports/session-order-format-fix-20261112-evidence';
await mkdir(output, { recursive: true });
const alias = '$${<FORMAT_IP>}';
const source = { messages: [{ role: 'user', content: 'Первый запрос:\r\n    server = ' + alias + '\r\n\tport = 443' }, { role: 'assistant', content: 'Первый ответ для ' + alias }, { role: 'user', content: 'Второй запрос: сравни ' + alias + ' и ' + alias }] };
const text = 'Второй ответ:\n    адрес 192.0.2.25';
const start = text.indexOf('192.0.2.25');
const step = { timestamp: '2026-11-12T00:00:00.000Z', state: 'complete', maskedPrompt: JSON.stringify(source), request: { body: source }, response: { status: 200, body: { text } }, interceptedSecrets: [{ key: 'FORMAT_IP', alias, realValue: '192.0.2.25' }], responseChanges: { version: 1, status: 'complete', items: [{ id: 'format', source: 'response-field', fieldId: 'response.text', key: 'FORMAT_IP', alias, value: '192.0.2.25', after: { text, start, end: start + 10, contextStart: 0, totalLength: text.length } }] } };
let current = step;
const errors = [], writes = [], results = [];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
page.setDefaultTimeout(5000);
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = async (name, run) => { await run(); results.push({ name, status: 'PASS' }); };
await page.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') writes.push(route.request().method());
  const path = new URL(route.request().url()).pathname;
  const data = path === '/api/routes' ? [{ id: 'fmt', prefix: 'fmt', name: 'Безопасный пример', incomingUrl: 'http://127.0.0.1:8767/fmt', upstreamUrl: 'https://example.invalid' }]
    : path === '/api/workspace' ? { visible: ['fmt'], selected: 'fmt' }
      : path === '/api/sessions' ? [{ id: 'format-session', client: 'Пример', endpoint: '/fmt/v1/chat/completions', lastSeen: step.timestamp }]
        : path.startsWith('/api/sessions/') ? [current]
          : path === '/api/vault' ? { manualSecrets: [], autoSecrets: [{ key: 'FORMAT_IP', alias, realValue: '192.0.2.25', hitCount: 2 }] }
            : path === '/api/patterns' ? [] : {};
  await route.fulfill({ status: 200, contentType: path === '/api/events' ? 'text/event-stream' : 'application/json', body: path === '/api/events' ? ': synthetic\n\n' : JSON.stringify(data) });
});
const sequence = () => page.locator('[data-occurrence-side]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-side') + (node.closest('[data-session-turn]').getAttribute('data-session-turn'))));
const order = async newest => { await page.getByRole('textbox', { name: 'Порядок сообщений', exact: true }).click(); await page.getByRole('option', { name: newest ? 'Последние сверху' : 'Последние снизу', exact: true }).click(); await page.waitForFunction(value => document.querySelector('[data-occurrence-side]')?.getAttribute('data-occurrence-side') === (value ? 'response' : 'request'), newest); };
const reload = async value => { current = value; await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-session-inspector]').waitFor(); };
try {
  await page.goto(process.env.CG_UI_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-formatted-fragment]').first().waitFor();
  await check('newest-all-four-blocks-order-and-association', async () => {
    assert.deepEqual(await sequence(), ['response2', 'request2', 'response1', 'request1']);
    assert.ok((await page.locator('[data-session-turn="1"] [data-occurrence-side="request"]').innerText()).includes('Первый запрос:'));
    assert.ok((await page.locator('[data-session-turn="1"] [data-occurrence-side="response"]').innerText()).includes('Первый ответ для'));
    await page.screenshot({ path: output + '/after-synthetic-newest.png', fullPage: true });
  });
  await check('oldest-all-four-blocks-order-and-association', async () => {
    await order(false);
    assert.deepEqual(await sequence(), ['request1', 'response1', 'request2', 'response2']);
    await page.screenshot({ path: output + '/after-synthetic-oldest.png', fullPage: true });
  });
  await check('formatted-contained-monospace-spaces-tabs-newlines', async () => {
    const field = page.locator('[data-occurrence-field="request.messages[0].content"]');
    assert.ok((await field.textContent()).includes('    server = '));
    assert.ok((await field.textContent()).includes('\tport = 443'));
    const geometry = await field.evaluate(node => {
      const panel = node.querySelector('[data-formatted-fragment]');
      const lines = panel.firstElementChild.children;
      const spacing = panel.querySelector('pre');
      return { font: getComputedStyle(lines[0]).fontFamily, background: getComputedStyle(panel).backgroundColor, padding: parseFloat(getComputedStyle(panel).paddingLeft), border: parseFloat(getComputedStyle(panel).borderTopWidth), lineCount: lines.length, preservedSpaces: getComputedStyle(spacing).whiteSpace, indentWidth: spacing.getBoundingClientRect().width };
    });
    assert.match(geometry.font, /monospace|Consolas|Menlo/i);
    assert.ok(geometry.padding >= 10 && geometry.border >= 1 && geometry.lineCount === 3 && geometry.indentWidth >= 25, JSON.stringify(geometry));
    assert.equal(geometry.preservedSpaces, 'pre');
    assert.equal(await page.locator('[data-formatted-fragment]').count(), 4);
    assert.equal(await page.locator('[data-session-content] .mantine-Spoiler-root,[data-session-content] .mantine-Accordion-root').count(), 0);
  });
  await check('order-change-does-not-reverse-fragment-content', async () => {
    const before = await page.locator('[data-occurrence-field="request.messages[0].content"]').textContent();
    await order(true);
    assert.equal(await page.locator('[data-occurrence-field="request.messages[0].content"]').textContent(), before);
    const chip = page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + alias, exact: true }).first();
    await chip.focus(); await page.keyboard.press('Enter');
    assert.equal(await chip.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape'); assert.equal(await chip.getAttribute('aria-expanded'), 'false');
  });
  await check('ctrl-navigation-without-imperative-root-class', async () => {
    await page.locator('[data-session-content]').getByRole('button', { name: 'Подстановка ' + alias, exact: true }).first().click({ modifiers: ['Control'] });
    await page.getByRole('tab', { name: 'Правила', exact: true, selected: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-secret-control')), false);
    await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
  });
  await check('pending-and-unbound-both-orders', async () => {
    await reload({ ...step, state: 'active', maskedPrompt: JSON.stringify({ system: alias }), response: undefined, responseChanges: { version: 1, status: 'pending', items: [] } });
    await order(true); assert.deepEqual(await sequence(), ['responseunbound', 'requestunbound']);
    await page.getByText('Ответ поступает', { exact: true }).waitFor();
    await order(false); assert.deepEqual(await sequence(), ['requestunbound', 'responseunbound']);
  });
  await check('explicit-full-and-long-literal-native-library-overflow', async () => {
    const long = 'абв😀'.repeat(150);
    await reload({ ...step, maskedPrompt: { messages: [{ role: 'user', content: 'Начало\n    ' + long + '\n' + alias + '\nКонец' }] } });
    await page.getByText('Расширенный', { exact: true }).click(); await page.getByText('Полный текст', { exact: true }).click();
    const field = page.locator('[data-occurrence-field="request.messages[0].content"]');
    assert.ok((await field.textContent()).includes(long));
    assert.ok((await field.innerText()).includes('Конец'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const vertical = await page.locator('[data-session-inspector]').evaluate(root => [...root.querySelectorAll('*')].filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length);
    assert.equal(vertical, 0);
    await page.screenshot({ path: output + '/after-full-long-literal.png', fullPage: true });
    await page.getByText('Простой', { exact: true }).click();
    assert.equal(await page.getByText('Полный текст', { exact: true }).count(), 0);
  });
  await check('single-double-four-space-and-tab-indent-request-response', async () => {
    const requestText = ['BASE ' + alias, ' INDENT_ONE ' + alias, '  INDENT_TWO ' + alias, '    INDENT_FOUR ' + alias, '\tINDENT_TAB ' + alias].join('\n');
    const responseText = requestText.replaceAll(alias, '192.0.2.25');
    const items = [...responseText.matchAll(/192\.0\.2\.25/g)].map((match, index) => ({ ...step.responseChanges.items[0], id: 'indent-' + index, after: { text: responseText, start: match.index, end: match.index + 10, contextStart: 0, totalLength: responseText.length } }));
    await reload({ ...step, maskedPrompt: { messages: [{ role: 'user', content: requestText }] }, response: { body: { text: responseText } }, responseChanges: { version: 1, status: 'complete', items } });
    const geometry = [];
    for (const side of ['request', 'response']) {
      const measured = await page.locator(`[data-occurrence-side="${side}"] [data-formatted-fragment]`).first().evaluate(root => {
        const found = {};
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const label of ['BASE', 'INDENT_ONE', 'INDENT_TWO', 'INDENT_FOUR', 'INDENT_TAB']) {
            const index = node.textContent.indexOf(label);
            if (index < 0) continue;
            const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
            const rect = range.getBoundingClientRect(); found[label] = { x: rect.x, width: rect.width };
          }
        }
        return found;
      });
      for (const [label, spaces] of [['INDENT_ONE', 1], ['INDENT_TWO', 2], ['INDENT_FOUR', 4]]) assert.ok(Math.abs(measured[label].x - measured.BASE.x - measured.BASE.width * spaces) < 1, JSON.stringify({ side, measured }));
      assert.ok(measured.INDENT_TAB.x > measured.INDENT_FOUR.x);
      geometry.push({ side, measured });
    }
    await writeFile(output + '/single-space-indent-geometry.json', JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: output + '/after-single-space-indent.png', fullPage: true });
  });
  await check('single-space-fix-retains-normal-word-wrapping', async () => {
    const paragraph = 'Обычный текст с одиночными пробелами между словами. '.repeat(24) + alias;
    await reload({ ...step, maskedPrompt: { messages: [{ role: 'user', content: paragraph }] } });
    await page.getByText('Расширенный', { exact: true }).click(); await page.getByText('Полный текст', { exact: true }).click();
    const field = page.locator('[data-occurrence-field="request.messages[0].content"]');
    assert.equal(await field.textContent(), paragraph);
    const dimensions = await field.evaluate(node => ({ height: node.getBoundingClientRect().height, width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(dimensions.height > 100 && dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
    await page.screenshot({ path: output + '/after-word-wrap.png' });
  });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log(`PASS desktop order/format ${results.length} checks, no API writes`);
} catch (error) {
  errors.push(error.message); await page.screenshot({ path: output + '/failure-synthetic.png', fullPage: true }); throw error;
} finally {
  await browser.close(); await writeFile(output + '/order-format-checks.json', JSON.stringify({ results, errors, writes, viewport: { width: 1440, height: 1000 }, closed: true }, null, 2));
}
