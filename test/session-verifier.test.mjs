import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSnapshotDigest } from '../src/sqlite-store.mjs';
import { computePackageDigest, verifySessionPackage } from '../src/session-verifier.mjs';
import { HashChainJournal } from '../src/journal.mjs';

function packageData() {
  const snapshot = {
    sceneSnapshot: { id: 'scene_1', name: 'Frozen room' },
    sourceRegistrySnapshot: [{ id: 'source_1' }],
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    runtimeBuildId: 'test',
    schemaSetDigest: 'schema'
  };
  const journal = new HashChainJournal({ sessionId: 'session_1', clock: () => 1000, idFactory: () => 'one' });
  const journalEvents = [journal.append('SessionOpened', { snapshotDigest: 'placeholder' }, 1000)];
  return {
    sessionId: 'session_1',
    format: 'sidechannel-session',
    formatVersion: '0.2',
    ...snapshot,
    snapshotDigest: computeSnapshotDigest(snapshot),
    historicalSnapshotComplete: true,
    journal: journalEvents,
    observations: [{ id: 'observation_1', sequence: 1, sourceId: 'source_1' }],
    events: [],
    privacy: { classes: ['local_numeric'], rawAudioIncluded: false, networkPayloadsIncluded: false, persistentDeviceIdsIncluded: false }
  };
}

test('session verifier accepts a self-contained untampered package', () => {
  const report = verifySessionPackage(packageData());
  assert.equal(report.ok, true);
  assert.equal(report.checks.snapshotDigestVerified, true);
  assert.equal(report.checks.journalVerified, true);
});

test('session verifier validates an optional package digest and detects tampering', () => {
  const packaged = packageData();
  packaged.packageDigest = computePackageDigest(packaged);
  const valid = verifySessionPackage(packaged);
  assert.equal(valid.ok, true);
  assert.equal(valid.checks.packageDigestVerified, true);
  packaged.observations[0].sequence = 2;
  const tampered = verifySessionPackage(packaged);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.reasons.includes('package digest mismatch'));
});

test('session verifier rejects packages beyond bounded observation limits', () => {
  const oversized = packageData();
  oversized.observations = Array.from({ length: 100_001 }, (_, index) => ({ id: 'observation_' + index, sequence: index + 1 }));
  const report = verifySessionPackage(oversized);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('observation count exceeds package limit'));
});

test('session verifier detects snapshot and sequence tampering', () => {
  const tampered = packageData();
  tampered.sceneSnapshot.name = 'Changed';
  tampered.observations.push({ id: 'observation_2', sequence: 1, sourceId: 'source_1' });
  tampered.journal[0].payload.snapshotDigest = 'tampered';
  const report = verifySessionPackage(tampered);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('snapshot digest mismatch'));
  assert.ok(report.reasons.includes('observation sequence is not strictly increasing'));
  assert.ok(report.reasons.includes('journal event digest mismatch'));
});
