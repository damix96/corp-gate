import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

const tx = o => ({ id: o.id, session_id: o.sid || 's1', timestamp: o.ts || new Date().toISOString(), latency_ms: 12, method: 'POST', url: o.url || '/anthropic/v1/messages', client: o.client || 'cli', prompt_text: JSON.stringify(o.body || { q: 'hi' }), model_response: JSON.stringify(o.res || { ok: true }), masked_prompt: JSON.stringify(o.masked || o.body || { q: 'hi' }), intercepted_secrets: JSON.stringify(o.secrets || []), target_url: 'https://api.anthropic.com', target_provider: 'anthropic', status: o.status || 200 });

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

test('overview: route tabs and connection instructions modal', async () => withHarness(async h => {
  h.seedRoute('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com');
  h.seedRoute('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1');
}, async h => {
  await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['anthropic', 'openai'], selected: 'anthropic' } });
  await h.open('/dashboard#overview');
  await h.page.getByRole('tab', { name: 'Anthropic' }).waitFor();
  await h.page.getByRole('tab', { name: 'OpenAI' }).click();
  await h.page.getByRole('button', { name: /Как подключить|How to connect/i }).click();
  const m = h.page.getByRole('dialog');
  await m.getByText(/Anthropic|OpenAI|Claude/i).first().waitFor();
  await m.locator('button.mantine-Modal-close').click();
  await m.waitFor({ state: 'hidden' });
}));

test('overview: sessions list seed, filter, select', async () => withHarness(async h => {
  h.seedRoute('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com');
  h.seedTransaction(tx({ id: 't1', sid: 'sess-alpha-001', client: 'alpha-cli' }));
  h.seedTransaction(tx({ id: 't2', sid: 'sess-beta-002', client: 'beta-cli' }));
}, async h => {
  await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['anthropic'], selected: 'anthropic' } });
  await h.open('/dashboard#overview');
  const list = h.page.locator('[aria-label="Сессии"], [aria-label="Sessions"]');
  await list.getByRole('button', { name: /sess-alpha-001/ }).waitFor();
  await h.page.getByPlaceholder(/сесс|session/i).fill('beta');
  await list.getByRole('button', { name: /sess-beta-002/ }).waitFor();
  await list.getByRole('button', { name: /sess-alpha-001/ }).waitFor({ state: 'detached' });
  await list.getByRole('button', { name: /sess-beta-002/ }).click();
  await h.page.getByText(/Session|Сессия/i).first().waitFor();
}));

test('overview: Advanced live preview follows session and clears on failed completion', async () => withHarness(async h => {
  h.seedRoute('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com');
  h.seedActiveTransaction(tx({ id: 't1', sid: 'sse1', body: { messages: [{ role: 'user', content: 'orig' }] }, masked: { messages: [{ role: 'user', content: 'masked' }] } }));
  h.seedActiveTransaction(tx({ id: 't2', sid: 'sse2', body: { messages: [{ role: 'user', content: 'other' }] }, masked: { messages: [{ role: 'user', content: 'other' }] } }));
}, async h => {
  await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['anthropic'], selected: 'anthropic' } });
  await h.page.addInitScript(() => localStorage.setItem('corpgate.interface-mode', 'advanced'));
  await h.open('/dashboard#overview');
  const list = h.page.locator('[aria-label="Сессии"], [aria-label="Sessions"]');
  await list.getByRole('button', { name: /sse1/ }).click();
  await h.page.locator('label').filter({ hasText: /Full|Полный/i }).click();
  await h.page.locator('[data-occurrence-side="request"]').getByText('masked', { exact: true }).waitFor();
  h.broadcast({ id: 'ev1', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sse1', transactionId: 't1', text: 'STREAM_DELTA_TEXT' } });
  const preview = h.page.getByRole('textbox', { name: 'Live response preview' });
  await preview.waitFor();
  assert.equal(await preview.inputValue(), 'STREAM_DELTA_TEXT');
  await list.getByRole('button', { name: /sse2/ }).click();
  await preview.waitFor({ state: 'hidden' });
  h.broadcast({ id: 'ev2', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sse2', transactionId: 't2', text: 'OTHER_LIVE_TEXT' } });
  await preview.waitFor();
  assert.equal(await preview.inputValue(), 'OTHER_LIVE_TEXT');
  h.broadcast({ id: 'ev3', type: 'transaction_completed', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sse1', transactionId: 't1', latest: false, status: 502 } });
  h.broadcast({ id: 'ev4', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sse2', transactionId: 't2', text: 'OTHER_STILL_LIVE' } });
  await h.page.waitForFunction(() => document.querySelector('[data-live-response] textarea')?.value === 'OTHER_STILL_LIVE');
  h.broadcast({ id: 'ev5', type: 'transaction_completed', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sse2', transactionId: 't2', latest: false, status: 502 } });
  await preview.waitFor({ state: 'hidden' });
}));

test('overview: ctrl+click secret token navigates to vault highlight', async () => withHarness(async h => {
  h.seedRoute('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com');
  h.seedSecret('SECRET_KEY', 'real-secret-value');
  h.seedTransaction(tx({ id: 't1', sid: 'nav1', body: { messages: [{ role: 'user', content: 'real-secret-value' }] }, masked: { messages: [{ role: 'user', content: '$${<SECRET_KEY>}' }] }, secrets: [{ key: 'SECRET_KEY', alias: '$${<SECRET_KEY>}', realValue: 'real-secret-value', count: 1 }] }));
}, async h => {
  await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['anthropic'], selected: 'anthropic' } });
  await h.open('/dashboard#overview');
  const list = h.page.locator('[aria-label="Сессии"], [aria-label="Sessions"]');
  await list.getByRole('button', { name: /nav1/ }).click();
  await h.page.getByRole('region', { name: 'Substitutions in request' }).locator('[data-secret-key="SECRET_KEY"]').click({ modifiers: ['Control'] });
  await h.page.locator('[data-secret-record="SECRET_KEY"]').waitFor();
}));
