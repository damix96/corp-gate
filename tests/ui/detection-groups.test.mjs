import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { DetectionGroups } = await tsImport('../../web/models/detection-groups.ts', import.meta.url);
const record = (key, hitCount) => ({ key, alias: '$${<' + key + '>}', hitCount });

test('interleaved prefixes form complete independent contiguous groups without changing records', () => {
  const records = [record('AUTO_IP_A', 2), record('AUTO_URL_A', 0), record('SINGLE', 1), record('AUTO_IP_B', 3), record('AUTO_URL_B', 4)];
  const before = JSON.stringify(records);
  const groups = DetectionGroups.build(records);
  assert.deepEqual(groups.map(group => group.records.map(item => item.key)), [['AUTO_IP_A', 'AUTO_IP_B'], ['AUTO_URL_A', 'AUTO_URL_B'], ['SINGLE']]);
  assert.deepEqual(groups.map(group => group.hits), [5, 4, 1]);
  assert.equal(JSON.stringify(records), before);
});

test('single matches and leading underscore names do not create false prefix groups', () => {
  const records = [record('AUTO_IP_A', 1), record('_A', 2), record('_B', 3)];
  assert.deepEqual(DetectionGroups.build(records).map(group => group.prefix), ['', '', '']);
  assert.deepEqual(DetectionGroups.build([]), []);
});

test('zero is retained; missing invalid and overflowing counts are explicitly partial', () => {
  const groups = DetectionGroups.build([record('AUTO_IP_A', 0), record('AUTO_IP_B', undefined), record('AUTO_IP_C', -1), record('AUTO_IP_D', NaN)]);
  assert.equal(groups[0].hits, 0);
  assert.equal(groups[0].unknownHits, 3);
  const overflow = DetectionGroups.build([record('AUTO_IP_A', Number.MAX_SAFE_INTEGER), record('AUTO_IP_B', 1)])[0];
  assert.equal(overflow.hits, Number.MAX_SAFE_INTEGER);
  assert.equal(overflow.unknownHits, 1);
});
