import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoOccurrenceArtifact } from '../src/evaluation/cooccurrence.mjs';

const sources = new Map([
  ['heat_source', { id: 'heat_source', range: [-20, 80], position: { x: .5, y: .5 } }],
  ['sound_source', { id: 'sound_source', range: [0, 1], position: { x: .5, y: .5 } }]
]);

const observations = [
  { id: 'heat_0', sourceId: 'heat_source', channel: 'heat', value: 20, timestampMs: 0, status: 'measured' },
  { id: 'sound_0', sourceId: 'sound_source', channel: 'sound', value: 0, timestampMs: 0, status: 'measured' },
  { id: 'heat_1', sourceId: 'heat_source', channel: 'heat', value: 80, timestampMs: 1000, status: 'measured' },
  { id: 'sound_1', sourceId: 'sound_source', channel: 'sound', value: 1, timestampMs: 1000, status: 'measured' },
  { id: 'heat_2', sourceId: 'heat_source', channel: 'heat', value: 20, timestampMs: 2000, status: 'measured' },
  { id: 'sound_2', sourceId: 'sound_source', channel: 'sound', value: 0, timestampMs: 2000, status: 'measured' }
];

test('co-occurrence artifact reports same-direction changes without causal language', () => {
  const artifact = createCoOccurrenceArtifact({
    observations,
    sources,
    channels: ['sound', 'heat'],
    bucketMs: 1000,
    changeThreshold: .2,
    maxLagMs: 1000,
    sourceSessionId: 'session_1'
  });
  assert.equal(artifact.format, 'sidechannel-cooccurrence');
  assert.equal(artifact.artifactState, 'derived');
  assert.deepEqual(artifact.channels, ['heat', 'sound']);
  assert.deepEqual(artifact.inputObservationIds, observations.map((observation) => observation.id));
  assert.equal(artifact.pairs.length, 1);
  assert.equal(artifact.pairs[0].lagEstimateMs, 0);
  assert.equal(artifact.pairs[0].support.sameDirectionBuckets, 2);
  assert.equal(artifact.pairs[0].interpretation, 'co-occurring change; not causal evidence');
  assert.equal(typeof artifact.outputDigest, 'string');
});

test('co-occurrence excludes stale and out-of-region observations', () => {
  const artifact = createCoOccurrenceArtifact({
    observations: [
      ...observations,
      { id: 'stale', sourceId: 'heat_source', channel: 'heat', value: 80, timestampMs: 3000, status: 'stale' },
      { id: 'outside', sourceId: 'heat_source', channel: 'heat', value: 80, timestampMs: 1000, status: 'measured', position: { x: 9, y: 9 } }
    ],
    sources,
    channels: ['heat', 'sound'],
    startMs: 0,
    endMs: 2000,
    bucketMs: 1000,
    region: { x: 0, y: 0, width: 1, height: 1 }
  });
  assert.deepEqual(artifact.inputObservationIds, observations.map((observation) => observation.id));
  assert.equal(artifact.window.endMs, 2000);
});

test('co-occurrence bounds and validates its analysis request', () => {
  assert.throws(() => createCoOccurrenceArtifact({ observations, sources, channels: ['heat'] }), /at least two channels/);
  assert.throws(() => createCoOccurrenceArtifact({ observations, sources, channels: ['heat', 'sound'], bucketMs: 1 }), /bucketMs/);
  assert.throws(() => createCoOccurrenceArtifact({
    observations,
    sources,
    channels: ['heat', 'sound'],
    region: { x: 0, y: 0, width: 1001, height: 1 }
  }), /region/);
});
