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

test('session verifier requires retained pose samples for pose-resolved observations', () => {
  const packaged = packageData();
  packaged.observations[0].poseRef = 'pose_1';
  packaged.observations[0].poseFrameId = 'scene';
  packaged.poses = [{
    schema: 'sidechannel.pose/1',
    sampleId: 'pose_1',
    sourceId: 'source_1',
    timestampMs: 1000,
    frameId: 'scene',
    position: { x: 1, y: 1 }
  }];
  const valid = verifySessionPackage(packaged);
  assert.equal(valid.ok, true);
  assert.equal(valid.checks.poseCount, 1);
  assert.equal(valid.checks.poseReferencesVerified, true);

  packaged.poses = [];
  const missing = verifySessionPackage(packaged);
  assert.equal(missing.ok, false);
  assert.equal(missing.checks.poseReferencesVerified, false);
  assert.ok(missing.reasons.some((reason) => reason.includes('pose sample not retained')));
});

test('session verifier rejects missing source, calibration, and derived-input references', () => {
  const packaged = packageData();
  packaged.observations[0].calibrationRef = 'cal_missing';
  packaged.observations[0].provenance = [{ parentId: 'observation_missing', relation: 'derived_from' }];
  const report = verifySessionPackage(packaged);
  assert.equal(report.ok, false);
  assert.equal(report.checks.calibrationReferencesVerified, false);
  assert.equal(report.checks.provenanceReferencesVerified, false);

  packaged.observations[0].sourceId = 'source_missing';
  const sourceReport = verifySessionPackage(packaged);
  assert.equal(sourceReport.ok, false);
  assert.equal(sourceReport.checks.sourceReferencesVerified, false);
});
