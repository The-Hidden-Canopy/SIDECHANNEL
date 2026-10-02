import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSnapshotDigest } from '../src/sqlite-store.mjs';
import { verifySessionPackage } from '../src/session-verifier.mjs';

function packageData() {
  const snapshot = {
    sceneSnapshot: { id: 'scene_1', name: 'Frozen room' },
    sourceRegistrySnapshot: [{ id: 'source_1' }],
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    runtimeBuildId: 'test',
    schemaSetDigest: 'schema'
  };
  return {
    format: 'sidechannel-session',
    formatVersion: '0.2',
    ...snapshot,
    snapshotDigest: computeSnapshotDigest(snapshot),
    historicalSnapshotComplete: true,
    observations: [{ id: 'observation_1', sequence: 1, sourceId: 'source_1' }],
    events: [],
    privacy: { classes: ['local_numeric'], rawAudioIncluded: false, networkPayloadsIncluded: false, persistentDeviceIdsIncluded: false }
  };
}

test('session verifier accepts a self-contained untampered package', () => {
  const report = verifySessionPackage(packageData());
  assert.equal(report.ok, true);
  assert.equal(report.checks.snapshotDigestVerified, true);
});

test('session verifier detects snapshot and sequence tampering', () => {
  const tampered = packageData();
  tampered.sceneSnapshot.name = 'Changed';
  tampered.observations.push({ id: 'observation_2', sequence: 1, sourceId: 'source_1' });
  const report = verifySessionPackage(tampered);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('snapshot digest mismatch'));
  assert.ok(report.reasons.includes('observation sequence is not strictly increasing'));
});
