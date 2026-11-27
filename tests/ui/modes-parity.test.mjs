import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

const tx = o => ({
  id: o.id, session_id: o.sid, timestamp: new Date().toISOString(), latency_ms: 15,
  method: 'POST', url: '/anthropic/v1/messages', client: 'cli-parity',
  prompt_text: JSON.stringify(o.body || { messages: [{ role: 'user', content: 'test payload' }], extra_service_field: 'technical_data' }),
  model_response: JSON.stringify({ content: [{ type: 'text', text: 'response test' }] }),
  masked_prompt: JSON.stringify(o.masked || { messages: [{ role: 'user', content: '$${<SECRET_PARITY>}' }], extra_service_field: 'technical_data' }),
  intercepted_secrets: JSON.stringify(o.secrets || [{ key: 'SECRET_PARITY', alias: '$${<SECRET_PARITY>}', realValue: 'secret_val_1', count: 2 }]),
  target_url: 'https://api.anthropic.com', target_provider: 'anthropic', status: 200
});

const withHarness = async (setup, run) => {
  const h = new UiBrowserHarness();
  await h.init();
  try {
    h.seedRoute('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com');
    await setup(h);
    await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['anthropic'], selected: 'anthropic' } });
    await h.open('/dashboard#overview');
    await run(h);
    h.assertClean();
  } finally {
    await h.close();
  }
};

const selectSession = (h, id) => h.page.locator('[aria-label="Sessions"]').getByRole('button', { name: new RegExp(id) }).click();
const advanced = async h => {
  await h.page.locator('label').filter({ hasText: /^Advanced$/ }).click();
  await h.page.waitForFunction(() => localStorage.getItem('corpgate.interface-mode') === 'advanced');
};

test('modes parity: Simple hides technical controls and stream; Advanced reveals them', async () => withHarness(async h => {
  h.seedActiveTransaction(tx({ id: 't_mode1', sid: 'sess_mode1' }));
}, async h => {
  await selectSession(h, 'sess_mode1');
  const inspector = h.page.locator('[data-session-inspector]');
  await inspector.waitFor();
  assert.equal(await inspector.getByRole('radiogroup', { name: 'Exchange view' }).count(), 0);
  assert.equal(await inspector.locator('[data-live-response]').count(), 0);
  h.broadcast({ id: 'ev_st1', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sess_mode1', transactionId: 't_mode1', text: 'SHOULD_NOT_SHOW_IN_SIMPLE' } });
  await advanced(h);
  await inspector.locator('label').filter({ hasText: /^JSON \/ HTTP$/ }).click();
  await inspector.getByText('technical_data', { exact: false }).first().waitFor();
  h.broadcast({ id: 'ev_st2', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'cli', details: { sessionId: 'sess_mode1', transactionId: 't_mode1', text: 'VISIBLE_IN_ADVANCED' } });
  await inspector.getByRole('textbox', { name: 'Live response preview' }).waitFor();
  assert.equal(await inspector.getByRole('textbox', { name: 'Live response preview' }).inputValue(), 'VISIBLE_IN_ADVANCED');
}));

test('modes parity: message order reverses turns and both exchange sides', async () => withHarness(async h => {
  const body = { messages: [{ role: 'user', content: 'first turn' }, { role: 'assistant', content: 'first answer' }, { role: 'user', content: 'second turn' }] };
  h.seedTransaction(tx({ id: 't_order', sid: 'sess_order', body, masked: body, secrets: [] }));
}, async h => {
  await selectSession(h, 'sess_order');
  const turns = h.page.locator('[data-session-turn]');
  await turns.first().waitFor();
  assert.deepEqual(await turns.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-session-turn'))), ['2', '1']);
  assert.deepEqual(await turns.first().locator('[data-occurrence-side]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-side'))), ['response', 'request']);
  await h.page.getByRole('textbox', { name: 'Message order' }).click();
  await h.page.getByRole('option', { name: 'Oldest first' }).click();
  await h.page.waitForFunction(() => localStorage.getItem('corpgate.message-order') === 'oldest');
  assert.deepEqual(await turns.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-session-turn'))), ['1', '2']);
  assert.deepEqual(await turns.first().locator('[data-occurrence-side]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-side'))), ['request', 'response']);
}));

test('modes parity: summary counts saved aliases once each and sorts by actual frequency', async () => withHarness(async h => {
  h.seedSecret('SECRET_ALPHA', 'val-alpha');
  h.seedSecret('SECRET_BETA', 'val-beta');
  h.seedTransaction(tx({
    id: 't_sub', sid: 'sess_sub',
    masked: { messages: [{ role: 'user', content: '$${<SECRET_BETA>} $${<SECRET_ALPHA>} $${<SECRET_ALPHA>}' }] },
    secrets: [
      { key: 'SECRET_ALPHA', alias: '$${<SECRET_ALPHA>}', realValue: 'val-alpha', count: 99 },
      { key: 'SECRET_BETA', alias: '$${<SECRET_BETA>}', realValue: 'val-beta', count: 99 }
    ]
  }));
}, async h => {
  await selectSession(h, 'sess_sub');
  const panel = h.page.getByRole('region', { name: 'Substitutions in request' });
  await panel.waitFor();
  assert.equal(await panel.locator('[data-substitution-total]').innerText(), '2');
  const chips = panel.locator('[data-substitution-alias]');
  assert.deepEqual(await chips.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-substitution-alias'))), ['$${<SECRET_ALPHA>}', '$${<SECRET_BETA>}']);
  assert.deepEqual(await chips.locator('[data-substitution-count]').allTextContents(), ['2', '1']);
  await chips.first().click({ modifiers: ['Control'] });
  await h.page.locator('[data-secret-record="SECRET_ALPHA"]').waitFor({ state: 'visible' });
}));
