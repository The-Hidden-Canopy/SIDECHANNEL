import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineDelta,
  createBaselineIndex,
  createBaselineSnapshot,
  latestValidObservations
} from '../public/baseline.mjs';

const normalize = (_channel, value) => Number(value);

test('baseline keeps the latest valid observation per source channel', () => {
  const observations = [
    { sourceId: 's1', channel: 'heat', timestampMs: 100, value: 0.2 },
    { sourceId: 's1', channel: 'heat', timestampMs: 200, value: 0.4 },
    { sourceId: 's1', channel: 'heat', timestampMs: 300, value: 0.9, status: 'stale' },
    { sourceId: 's2', channel: 'rf', timestampMs: 150, value: 0.7, status: 'rejected' }
  ];

  assert.deepEqual(latestValidObservations(observations), [observations[1]]);
  const snapshot = createBaselineSnapshot({ sceneId: 'scene_1', capturedAtMs: 999, observations, normalize });
  assert.equal(snapshot.schemaVersion, 'sidechannel.baseline/1');
  assert.equal(snapshot.observationCount, 1);
  assert.equal(snapshot.sampleCount, 1);
  assert.equal(snapshot.observations[0].mean, 0.4);
  assert.equal(snapshot.observations[0].stdDev, 0.05);
});

test('baseline computes a bounded signed z-score and absent references fail closed', () => {
  const snapshot = createBaselineSnapshot({
    sceneId: 'scene_1',
    samples: [
      { sourceId: 's1', channel: 'heat', timestampMs: 100, value: 0.25 },
      { sourceId: 's1', channel: 'heat', timestampMs: 200, value: 0.35 }
    ],
    normalize
  });
  const index = createBaselineIndex(snapshot);
  assert.equal(baselineDelta({ sourceId: 's1', channel: 'heat', value: 0.75 }, index, normalize), 4);
  assert.ok(Math.abs(baselineDelta({ sourceId: 's1', channel: 'heat', value: 0.25 }, index, normalize) + 1) < 1e-9);
  assert.equal(baselineDelta({ sourceId: 'missing', channel: 'heat', value: 0.75 }, index, normalize), null);
});
