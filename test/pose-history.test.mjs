import test from 'node:test';
import assert from 'node:assert/strict';
import { PoseHistory, validatePoseSample } from '../src/spatial/pose-history.mjs';

test('pose history validates, orders, bounds, and resolves nearest samples', () => {
  const history = new PoseHistory({ maxSamplesPerSource: 2, maxTotalSamples: 3, clock: () => 5000 });
  assert.equal(validatePoseSample({ sampleId: 'bad', sourceId: 's', timestampMs: 1, frameId: 'scene', position: { x: 1 } }).ok, false);
  assert.equal(history.add({ sampleId: 'pose_late', sourceId: 's', timestampMs: 3000, frameId: 'scene', position: { x: 3, y: 0 } }).ok, true);
  assert.equal(history.add({ sampleId: 'pose_early', sourceId: 's', timestampMs: 1000, frameId: 'scene', position: { x: 1, y: 0 } }).ok, true);
  assert.equal(history.add({ sampleId: 'pose_middle', sourceId: 's', timestampMs: 2000, frameId: 'scene', position: { x: 2, y: 0 } }).ok, true);
  assert.deepEqual(history.list('s').map((sample) => sample.sampleId), ['pose_middle', 'pose_late']);
  const resolved = history.resolve('s', 2150, { maxAgeMs: 500, frameId: 'scene' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.sample.sampleId, 'pose_middle');
  assert.equal(resolved.distanceMs, 150);
  assert.equal(history.resolve('s', 5000, { maxAgeMs: 100 }).reason.id, 'pose.stale');
});

test('pose history rejects duplicate samples and frame-mismatched resolution', () => {
  const history = new PoseHistory();
  const sample = { sampleId: 'pose_1', sourceId: 's', timestampMs: 1000, frameId: 'sensor', position: { x: 1, y: 2 } };
  assert.equal(history.add(sample).ok, true);
  assert.equal(history.add(sample).reasons[0].id, 'pose.duplicate');
  assert.equal(history.resolve('s', 1000, { frameId: 'scene' }).reason.id, 'pose.missing');
});
