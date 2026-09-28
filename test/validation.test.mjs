import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFreshness, validateObservation } from '../src/validation.mjs';

const sources = new Map([[
  'sensor_1',
  { id: 'sensor_1', range: [0, 100], freshnessWindowMs: 1000 }
]]);

test('accepts a valid normalized observation', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_123',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    receivedAtMs: 1001,
    value: 22.5,
    unit: 'C',
    status: 'measured',
    quality: { score: 0.95, state: 'good', reasons: [] },
    position: { x: 1, y: 2 }
  }, { sources, now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.quality.score, 0.95);
});

test('rejects malformed, unknown, and out-of-range observations', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'bad',
    sourceId: 'missing',
    channel: 'heat',
    timestampMs: 1000,
    value: 101,
    unit: 'C',
    status: 'measured'
  }, { sources, now: 1000 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((item) => item.id === 'sourceId.unknown'));
});

test('marks observations stale without converting them to zero', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_stale',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    value: 20,
    unit: 'C',
    status: 'measured'
  }, { sources, now: 1000 });
  const stale = applyFreshness(result.observation, sources.get('sensor_1'), 2501);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.value, 20);
  assert.equal(stale.quality.state, 'stale');
});

