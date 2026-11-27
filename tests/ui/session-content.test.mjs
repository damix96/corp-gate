import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { SessionPayload } = await tsImport('../../web/models/session-payload.ts', import.meta.url);
const { SessionAliases } = await tsImport('../../web/models/session-aliases.ts', import.meta.url);
const { SessionFragments } = await tsImport('../../web/models/session-fragments.ts', import.meta.url);
const { SessionOccurrences } = await tsImport('../../web/models/session-occurrences.ts', import.meta.url);
const alias = '$${<HOST>}';
const rep = '$${<HOST__GV_URL_1>}';
const step = { timestamp: '', interceptedSecrets: [{ key: 'HOST', alias, realValue: 'a/b', representations: [{ alias: rep, value: 'a%2Fb', format: 'urlEncoded' }] }] };

test('summary frequency order is exact, deterministic and keeps unknown counts after zero', () => {
  const entries = [
    { alias: 'Z', count: undefined }, { alias: 'B', count: 2 },
    { alias: 'A', count: 2 }, { alias: 'ZERO', count: 0 },
    { alias: 'BAD', count: NaN }, { alias: 'TOP', count: 9 },
  ].map(item => ({ ...item, key: item.alias, known: false }));
  assert.deepEqual(SessionAliases.frequency(entries).map(item => [item.alias, item.count]), [
    ['TOP', 9], ['A', 2], ['B', 2], ['ZERO', 0], ['BAD', NaN], ['Z', undefined],
  ]);
  assert.equal(entries[0].alias, 'Z');
  assert.equal(SessionAliases.knownCount(entries[3]), 0);
  assert.equal(SessionAliases.knownCount(entries[4]), undefined);
});

test('serialized tool values decode aliases once and exclude JSON property names at every nesting level', () => {
  const serialized = '{"value":"\\u0024\\u0024{<HOST>}","$${<QA_UNKNOWN>}":"plain"}';
  const payload = { messages: [{ role: 'assistant', tool_calls: [{ function: { arguments: serialized } }] }] };
  const aliases = new SessionAliases(step);
  assert.deepEqual(aliases.used(payload).map(item => [item.alias, item.count]), [[alias, 1]]);
  const fields = SessionOccurrences.fields(payload, aliases);
  assert.equal(fields.reduce((count, field) => count + field.matches.length, 0), 1);
  assert.ok(fields.some(field => field.text === alias));
  const nested = { arguments: JSON.stringify({ array: [serialized, { [alias]: 'plain', value: rep }] }) };
  assert.deepEqual(aliases.used(nested).map(item => [item.alias, item.count]), [[alias, 1], [rep, 1]]);
  assert.equal(aliases.used({ text: 'plain ' + alias })[0].count, 1);
});
const evidence = (text, start, value = 'IP', extra = {}) => ({ id: String(start), source: 'response-field', fieldId: 'content.0', alias, value, after: { text, start, end: start + value.length, contextStart: 0, totalLength: text.length }, ...extra });

test('serialized context preserves roles, paths and exact occurrence counts', () => {
  const raw = JSON.stringify({ messages: [{ role: 'user', content: `${alias} then ${alias}` }, { role: 'assistant', content: rep }] });
  const parsed = SessionPayload.parse(raw);
  assert.equal(SessionPayload.fields(parsed)[1].path, 'request.messages[0].content');
  assert.equal(SessionPayload.messages(parsed)[0].role, 'user');
  const entries = new SessionAliases(step).used(parsed);
  assert.deepEqual(entries.map(e => [e.alias, e.count, e.realValue]), [[alias, 2, 'a/b'], [rep, 1, 'a%2Fb']]);
  assert.equal(SessionPayload.parse(undefined), undefined);
  assert.equal(SessionPayload.parse('not JSON'), 'not JSON');
});

test('turns group tool results and assistant messages until the next actual user', () => {
  const body = { messages: [{ role: 'system', content: 'setup' }, { role: 'user', content: 'first' }, { role: 'assistant', tool_calls: [{ id: 'a' }] }, { role: 'user', content: [{ type: 'tool_result', content: 'result' }] }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'second' }, { role: 'tool', content: 'other result' }] };
  const grouped = SessionPayload.turns(SessionPayload.messages(body));
  assert.equal(grouped.setup.length, 1);
  assert.deepEqual(grouped.turns.map(turn => turn.messages.map(m => m.role)), [['user', 'assistant', 'tool', 'assistant'], ['user', 'tool']]);
  assert.deepEqual([...grouped.turns].reverse()[1].messages.map(m => m.id), grouped.turns[0].messages.map(m => m.id));
  assert.equal(SessionPayload.turns(SessionPayload.messages({ data: 'no role' })).turns.length, 0);
  assert.equal(SessionPayload.turns(SessionPayload.messages({ role: 'user', content: 'explicit standalone message' })).turns.length, 1);
  assert.equal(SessionPayload.messages({ contents: [{ role: 'user', parts: [{ functionResponse: { response: 'done' } }] }] })[0].role, 'tool');
});

test('normalized role is shared by standalone messages, nested fields and protocol outputs without changing bodies', () => {
  const sources = [{ role: 'user', content: [{ type: 'tool_result', content: 'result' }] }, { role: 'user', parts: [{ functionResponse: { response: 'result' } }] }, { type: 'function_call_output', output: 'result' }, { type: 'custom_tool_call_output', output: 'result' }];
  for (const source of sources) {
    const saved = JSON.stringify(source);
    assert.equal(SessionPayload.role(source), 'tool');
    assert.ok(SessionPayload.fields(source).every(field => field.role === 'tool'));
    const message = SessionPayload.messages({ messages: [source] })[0];
    assert.equal(message.role, 'tool');
    assert.equal(message.body, source);
    assert.equal(JSON.stringify(source), saved);
  }
  assert.equal(SessionPayload.role({ role: 'user', content: [{ type: 'text', text: 'new question' }, { type: 'tool_result', content: 'result' }] }), 'user');
  assert.equal(SessionPayload.role({ output: 'arbitrary data' }), 'unknown');
});

test('known, unknown and representation tokens coexist without guessing base values', () => {
  const registry = new SessionAliases(step);
  const missingRep = '$${<HOST__GV_NOT_SAVED>}';
  const rows = registry.used({ content: [alias, rep, missingRep, '$${<MISSING>}'] });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.known), [true, true, false, false]);
  assert.equal(rows[2].realValue, undefined);
  const hidden = new SessionAliases({ timestamp: '', interceptedSecrets: [{ ...step.interceptedSecrets[0], valueHidden: true }] });
  assert.equal(hidden.entries.get(alias).realValue, undefined);
  assert.equal(hidden.entries.get(rep).realValue, undefined);
  assert.equal(new SessionAliases({ timestamp: '', interceptedSecrets: [{ key: 'EMPTY', alias: '$${<EMPTY>}', realValue: '' }] }).entries.get('$${<EMPTY>}').realValue, '');
});

test('substitution list counts only exact aliases in saved sent request including history', () => {
  const unknown = '$${<UNSAVED>}';
  const sent = { system: alias, messages: [{ role: 'user', content: `${alias} ${alias} ${rep} ${unknown}` }, { role: 'assistant', content: alias }, { role: 'tool', arguments: JSON.stringify({ url: rep }) }, { role: 'user', content: `${alias} ${unknown}` }] };
  const scoped = { ...step, request: { body: alias.repeat(19) }, maskedPrompt: JSON.stringify(sent), response: { body: alias.repeat(7) + '$${<RESPONSE_ONLY>}' }, responseChanges: { version: 1, items: [evidence('IP', 0)] } };
  const registry = new SessionAliases(scoped);
  const rows = registry.used(SessionPayload.parse(scoped.maskedPrompt));
  assert.deepEqual(rows.map(row => [row.alias, row.count, row.known]), [[alias, 5, true], [rep, 2, true], [unknown, 2, false]]);
  assert.equal(rows[1].realValue, 'a%2Fb');
  assert.deepEqual(registry.used(undefined), []);
  assert.deepEqual(registry.used({ messages: [] }), []);
  assert.equal(JSON.stringify(sent), scoped.maskedPrompt);
});

test('context preserves LF/CRLF, multiline matches and surrogate boundaries', () => {
  for (const newline of ['\n', '\r\n']) {
    const text = ['exclude', 'before', 'left MATCH right', 'after', 'exclude'].join(newline);
    const range = SessionFragments.around(text, text.indexOf('MATCH'), text.indexOf('MATCH') + 5);
    assert.equal(text.slice(range.start, range.end), ['before', 'left MATCH right', 'after'].join(newline));
  }
  const multi = 'x\nbefore\nMATCH\nMIDDLE\nEND\nafter\nx';
  const r = SessionFragments.around(multi, multi.indexOf('MATCH'), multi.indexOf('END') + 3);
  assert.equal(multi.slice(r.start, r.end).split('\n').length, 5);
  const unicode = 'a'.repeat(50) + '😀MATCH😀' + 'b'.repeat(50);
  const u = SessionFragments.around(unicode, 52, 57, 1);
  assert.equal(unicode.slice(u.start, u.end), 'MATCH');
});

test('compatible response windows merge occurrences, duplicates dedupe, fields remain distinct', () => {
  const text = 'IP together IP';
  const items = [evidence(text, 0), evidence(text, 12), evidence(text, 12)];
  const group = SessionFragments.restorations(items);
  assert.equal(group.windows.length, 1);
  assert.equal(group.windows[0].matches.length, 2);
  assert.equal(group.windows[0].text, text);
  assert.equal(SessionFragments.restorations([...items, evidence(text, 0, 'IP', { fieldId: 'other' })]).windows.length, 2);
  const unanchored = items.slice(0, 2).map(item => ({ ...item, after: { text, start: item.after.start, end: item.after.end } }));
  assert.equal(SessionFragments.restorations(unanchored).windows.length, 2);
});

test('invalid, conflicting and hidden evidence never invents a range', () => {
  const invalid = [evidence('IP', -1), evidence('IP', 0, 'wrong'), evidence('IP', 0, 'IP', { after: 'IP' }), evidence('IP', 0, 'IP', { after: { text: 'IP', start: 0, end: 99 } })];
  assert.equal(SessionFragments.restorations(invalid).rejected, 4);
  const conflict = SessionFragments.restorations([evidence('IPX', 0, 'IP'), evidence('IPX', 1, 'PX', { alias: '$${<OTHER>}' })]);
  assert.equal(conflict.rejected, 1);
  assert.equal(conflict.windows[0].matches.length, 1);
  const hidden = evidence('[protected]', 0, '[protected]', { valueHidden: true });
  assert.equal(SessionFragments.restorations([hidden]).windows[0].matches[0].valueHidden, true);
  const empty = evidence('beforeafter', 6, '');
  assert.equal(SessionFragments.restorations([empty]).windows[0].matches[0].start, 6);
  const before = { ...evidence('IP', 0), before: { text: `hello ${alias}`, start: 6, end: 6 + alias.length, contextStart: 0 } };
  assert.equal(SessionFragments.restorations([before], 'before').windows[0].text, `hello ${alias}`);
});

test('technical views redact credential keys, nested serialized bodies, raw and URL credentials', () => {
  const secret = 'fixture-credential-never-visible';
  const value = { headers: { Authorization: `Bearer ${secret}`, COOKIE: secret }, body: JSON.stringify({ api_key: secret, nested: { refresh_token: secret }, text: 'visible' }), url: `https://example.invalid/?api_key=${secret}`, raw: `data: ${secret}` };
  const safe = JSON.stringify(SessionPayload.safe(value));
  assert.ok(!safe.includes(secret));
  assert.ok(safe.includes('visible'));
  assert.ok(JSON.stringify(value).includes(secret));
});

test('occurrence sides preserve real turn boundaries and every nested tool, setup and extra field match', () => {
  const registry = new SessionAliases(step);
  const body = { system: alias, tools: [{ description: rep }], messages: [{ role: 'user', content: alias + ' ' + alias }, { role: 'assistant', tool_calls: [{ function: { arguments: JSON.stringify({ nested: { host: rep, note: alias } }) } }] }, { role: 'user', content: [{ type: 'tool_result', content: alias }] }, { role: 'user', content: 'second ' + rep }, { role: 'tool', content: { output: alias } }] };
  const saved = JSON.stringify(body);
  const turns = SessionOccurrences.turns({ ...step, maskedPrompt: saved }, registry);
  const count = fields => fields.reduce((sum, field) => sum + field.matches.length, 0);
  assert.deepEqual(turns.map(turn => [turn.index, count(turn.request), count(turn.response), turn.latest]), [[1, 4, 3, false], [2, 1, 1, true]]);
  assert.ok(turns[0].response.some(field => field.path.endsWith('.arguments.nested.host') && field.text === rep));
  assert.equal(JSON.stringify(body), saved);
  assert.equal(turns.flatMap(turn => [...turn.request, ...turn.response]).flatMap(field => field.matches).length, 9);
});

test('missing sent data and unbound context never fabricate a user request or borrow original text', () => {
  const registry = new SessionAliases(step);
  const missing = SessionOccurrences.turns({ ...step, request: { body: { messages: [{ role: 'user', content: alias }] } } }, registry);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].index, undefined);
  assert.deepEqual(missing[0].request, []);
  const setup = SessionOccurrences.turns({ ...step, maskedPrompt: { messages: [{ role: 'system', content: alias }] } }, registry);
  assert.equal(setup[0].index, undefined);
  assert.equal(setup[0].request.find(field => field.matches.length)?.text, alias);
  const standalone = SessionOccurrences.turns({ ...step, maskedPrompt: { role: 'user', content: alias } }, registry);
  assert.equal(standalone[0].index, 1);
  assert.equal(standalone[0].request.find(field => field.matches.length)?.text, alias);
});

test('top-level message arrays assign each occurrence to its actual turn and side', () => {
  const registry = new SessionAliases(step);
  const body = [{ role: 'user', content: 'ARRAY_USER_1 ' + alias }, { role: 'tool', content: 'ARRAY_TOOL ' + alias }, { role: 'user', content: 'ARRAY_USER_2 ' + rep }];
  for (const maskedPrompt of [body, JSON.stringify(body)]) {
    const turns = SessionOccurrences.turns({ ...step, maskedPrompt }, registry);
    const found = fields => fields.filter(field => field.matches.length).map(field => field.text);
    assert.deepEqual(turns.map(turn => [found(turn.request), found(turn.response)]), [[['ARRAY_USER_1 ' + alias], ['ARRAY_TOOL ' + alias]], [['ARRAY_USER_2 ' + rep], []]]);
    assert.deepEqual(turns.map(turn => turn.index), [1, 2]);
    assert.equal(turns[0].response.find(field => field.matches.length).path, 'request[1].content');
  }
});

test('chronological order reverses sides and turns together without mutating fragments or associations', () => {
  const registry = new SessionAliases(step);
  const body = { messages: [{ role: 'user', content: 'first\n    ' + alias }, { role: 'tool', content: 'first result ' + rep }, { role: 'user', content: 'second ' + alias }] };
  const turns = SessionOccurrences.turns({ ...step, maskedPrompt: body }, registry);
  const before = JSON.stringify(turns);
  const sequence = newest => SessionOccurrences.ordered(turns, newest).flatMap(({ turn, sides }) => sides.map(side => `${side}${turn.index}`));
  assert.deepEqual(sequence(false), ['request1', 'response1', 'request2', 'response2']);
  assert.deepEqual(sequence(true), ['response2', 'request2', 'response1', 'request1']);
  assert.equal(JSON.stringify(turns), before);
  const unbound = SessionOccurrences.turns({ ...step, maskedPrompt: { system: alias } }, registry);
  assert.deepEqual(SessionOccurrences.ordered(unbound, true)[0].sides, ['response', 'request']);
  assert.equal(SessionOccurrences.ordered(unbound, true)[0].turn.index, undefined);
  assert.equal(SessionOccurrences.ordered(turns, true)[1].turn.response.find(field => field.matches.length).text, 'first result ' + rep);
});

test('occurrence traversal redacts serialized credentials but retains exact mixed aliases and multiline context', () => {
  const registry = new SessionAliases(step);
  const fields = SessionOccurrences.fields({ input: JSON.stringify({ api_key: alias, text: rep + '\r\n' + '$${<UNKNOWN>}' + ' ' + alias }) }, registry);
  assert.ok(!fields.some(field => field.text === alias));
  assert.equal(fields.reduce((sum, field) => sum + field.matches.length, 0), 3);
  const found = fields.find(field => field.matches.length);
  assert.equal(found.text, rep + '\r\n' + '$${<UNKNOWN>}' + ' ' + alias);
  assert.deepEqual(found.matches.map(match => found.text.slice(match.start, match.end)), [rep, '$${<UNKNOWN>}', alias]);
});
