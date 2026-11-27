import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { UiBrowserHarness } from './harness.mjs';

describe('installation guidance and set-only input', () => {
  const h = new UiBrowserHarness();
  before(async () => {
    await h.init();
    h.seedRoute('work-litellm', 'Work LiteLLM', 'work-litellm', 'https://litellm.corp.example/api', '', 1);
    h.seedSecret('INPUT_EXISTING', 'synthetic-before', 'Existing variable');
    await h.host.app.inject({ method: 'POST', url: '/api/workspace', headers: h.adminHeaders(), payload: { visible: ['work-litellm'], selected: 'work-litellm' } });
    await h.open();
  });
  after(async () => h.close());

  const openSet = async path => {
    await h.open(path || '/vault/set');
    await h.page.getByRole('heading', { name: 'Set Secret Values', exact: true }).waitFor();
    await h.page.locator('#secretInputName0').waitFor({ state: 'visible' });
    await h.page.waitForFunction(() => !document.querySelector('#secretInputName0')?.disabled);
  };
  const fill = async (index, name, value) => {
    await h.page.locator(`#secretInputName${index}`).fill(name);
    await h.page.locator(`#secretInputValue${index}`).fill(value);
  };
  const linked = async variables => h.page.evaluate(async specs => {
    const headers = { 'content-type': 'application/json', 'x-corpgate-input': '1' };
    const session = await fetch('/api/secret-input/session', { method: 'POST', headers, body: '{}' }).then(response => response.json());
    const response = await fetch('/api/secret-input/requests', { method: 'POST', headers: { ...headers, authorization: `Intake ${session.formToken}` }, body: JSON.stringify({ operation: 'set', variables: specs, idempotencyKey: crypto.randomUUID() }) });
    if (!response.ok) throw new Error('Linked set request creation failed');
    return response.json();
  }, variables);

  test('fresh and invalid locale default to English while saved choices survive reload', async () => {
    assert.equal(await h.page.locator('html').getAttribute('lang'), 'en');
    await h.page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
    await h.page.evaluate(() => localStorage.setItem('cg-locale', 'ru'));
    await h.page.reload();
    await h.page.getByRole('tab', { name: 'Обзор', exact: true }).waitFor();
    assert.equal(await h.page.locator('html').getAttribute('lang'), 'ru');
    await h.page.evaluate(() => localStorage.setItem('cg-locale', 'en'));
    await h.page.reload();
    await h.page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
    await h.page.evaluate(() => localStorage.setItem('cg-locale', 'invalid-locale'));
    await h.page.reload();
    await h.page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
    assert.equal(await h.page.locator('html').getAttribute('lang'), 'en');
    h.assertClean();
  });

  test('connection guidance preserves LiteLLM route and provides an offline recovery note before endpoint edits', async () => {
    await h.page.getByRole('button', { name: 'How to connect', exact: true }).click();
    const dialog = h.page.getByRole('dialog');
    await dialog.getByText('Before changing your AI client', { exact: true }).waitFor();
    const text = await dialog.innerText();
    assert.ok(text.indexOf('Find the working connection') < text.indexOf('Configure CorpGate first'));
    assert.ok(text.indexOf('Check the route before switching') < text.indexOf('Then update only the endpoint'));
    assert.match(text, /managed files, environment variables, launch arguments, IDE and corporate launcher/);
    assert.match(text, /LiteLLM/);
    assert.match(text, /https:\/\/litellm\.corp\.example\/api/);
    assert.doesNotMatch(text, /MYOC_API_KEY|deepseek-v4\.1|YOUR_KEY/);
    await dialog.getByRole('button', { name: 'Copy setup and recovery note', exact: true }).click();
    const note = await h.page.evaluate(() => navigator.clipboard.readText());
    assert.match(note, /Client configuration source, key and scope/);
    assert.match(note, /https:\/\/litellm\.corp\.example\/api/);
    assert.match(note, /npx corp-gate status/);
    assert.match(note, /npx corp-gate start/);
    assert.match(note, /interactive Task Scheduler task/);
    assert.match(note, /npx corp-gate probe --connection work-litellm/);
    assert.match(note, /restore only the previous endpoint/);
    const route = h.host.database.getAllRoutes().find(item => item.id === 'work-litellm');
    assert.equal(route.upstream_url, 'https://litellm.corp.example/api');
    await dialog.getByRole('button', { name: 'Claude Code', exact: true }).click();
    await dialog.getByText(/Keep the current token, API-key helper/).waitFor();
    await dialog.getByText(/"ANTHROPIC_BASE_URL"/).waitFor();
    assert.match(await dialog.innerText(), /"ANTHROPIC_BASE_URL": "http:\/\/127\.0\.0\.1:\d+\/work-litellm"/);
    await dialog.locator('button.mantine-Modal-close').click();
    await dialog.waitFor({ state: 'hidden' });
    h.assertClean();
  });

  test('one set form creates and updates a mixed batch without loading previous values', async () => {
    await openSet();
    await fill(0, 'INPUT_EXISTING', ' synthetic-after-秘密 ');
    await h.page.locator('#secretInputDesc0').fill('Edited description');
    await h.page.getByRole('button', { name: 'Add variable', exact: true }).click();
    await fill(1, 'INPUT_CREATED', 'synthetic-created');
    await h.page.locator('label[for="secretInputDpapi1"]').click();
    assert.equal(await h.page.locator('#secretInputDpapi1').isChecked(), false);
    await h.page.locator('#secretInputDesc1').fill('Created description');
    const create = h.page.waitForRequest(request => request.url().endsWith('/api/secret-input/requests') && request.method() === 'POST');
    await h.page.getByRole('button', { name: 'Save values', exact: true }).click();
    assert.equal((await create).postDataJSON().operation, 'set');
    await h.page.getByText('Secret values saved', { exact: true }).waitFor();
    assert.equal(await h.page.locator('#secretInputValue0').count(), 0);
    const entries = h.host.server.getVault().getManualSecrets();
    const previous = entries.find(item => item.key === 'INPUT_EXISTING');
    const created = entries.find(item => item.key === 'INPUT_CREATED');
    assert.equal(previous.realValue, ' synthetic-after-秘密 ');
    assert.equal(previous.alias, '$${<INPUT_EXISTING>}');
    assert.equal(previous.description, 'Edited description');
    assert.equal(created.realValue, 'synthetic-created');
    assert.equal(created.description, 'Created description');
    assert.equal(created.isSecret, false);
    assert.equal(new URL(h.page.url()).pathname, '/vault/set');
    h.assertClean();
  });

  test('linked set metadata is shown and cancelling clears the form without changing Vault', async () => {
    await h.open();
    const before = h.host.server.getVault().getManualSecrets().find(item => item.key === 'INPUT_EXISTING').realValue;
    const view = await linked([{ name: 'INPUT_EXISTING', description: 'Linked metadata', isSecret: false }, { name: 'INPUT_CANCELLED', description: 'New linked variable', isSecret: false }]);
    assert.equal(view.operation, 'set');
    assert.equal(view.launch, 'not_requested');
    await openSet(new URL(view.url).pathname);
    assert.equal(await h.page.locator('#secretInputValue0').inputValue(), '');
    assert.equal(await h.page.locator('#secretInputDesc0').inputValue(), 'Linked metadata');
    assert.equal(await h.page.locator('#secretInputDpapi0').isChecked(), false);
    await h.page.locator('#secretInputValue0').fill('synthetic-not-saved');
    await h.page.locator('#secretInputValue1').fill('synthetic-not-created');
    await h.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await h.page.getByText('Input cancelled', { exact: true }).waitFor();
    assert.equal(await h.page.locator('#secretInputValue0').count(), 0);
    const entries = h.host.server.getVault().getManualSecrets();
    assert.equal(entries.find(item => item.key === 'INPUT_EXISTING').realValue, before);
    assert.equal(entries.some(item => item.key === 'INPUT_CANCELLED'), false);
    h.assertClean();
  });

  test('lost submission outcome is checked by status without resending secret values', async () => {
    await openSet();
    await fill(0, 'INPUT_REVIEW', 'synthetic-review-value');
    await h.page.locator('label[for="secretInputDpapi0"]').click();
    assert.equal(await h.page.locator('#secretInputDpapi0').isChecked(), false);
    let submissions = 0;
    await h.context.route('**/api/secret-input/requests/*/submit', async route => {
      submissions++;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.fulfill({ response, body: 'response lost after the server committed', contentType: 'application/json' });
    });
    await h.page.getByRole('button', { name: 'Save values', exact: true }).click();
    await h.page.getByRole('button', { name: 'Check result', exact: true }).waitFor();
    assert.equal(await h.page.locator('#secretInputValue0').inputValue(), '');
    const status = h.page.waitForRequest(request => /\/api\/secret-input\/requests\/[^/]+$/.test(new URL(request.url()).pathname) && request.method() === 'GET');
    await h.page.getByRole('button', { name: 'Check result', exact: true }).click();
    await status;
    await h.page.getByText('Secret values saved', { exact: true }).waitFor();
    assert.equal(submissions, 1);
    assert.equal(h.host.server.getVault().getManualSecrets().find(item => item.key === 'INPUT_REVIEW').realValue, 'synthetic-review-value');
    await h.context.unroute('**/api/secret-input/requests/*/submit');
    h.assertClean();
  });
});
