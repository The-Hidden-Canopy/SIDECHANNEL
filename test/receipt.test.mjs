import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayReceipt, verifyReplayReceipt } from '../src/verification/receipt.mjs';

function session() {
  const source = { id: 'source_1', range: [0, 100], position: { x: 1, y: 1 }, channels: ['heat'] };
  return {
    id: 'sess_receipt',
    snapshotDigest: 'snapshot_digest',
    runtimeBuildId: 'test-runtime',
    schemaSetDigest: 'schema_digest',
    sceneSnapshot: { id: 'scene_1', width: 2, height: 2 },
    sourceRegistrySnapshot: [source],
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    observations: [{
      id: 'observation_1',
      sourceId: source.id,
      channel: 'heat',
      value: 40,
      timestampMs: 1000,
      sequence: 1,
      quality: { score: 1 },
      metadata: { scenario: 'deterministic-room', seed: 1337 }
    }],
    events: []
  };
}

test('replay receipt records deterministic software evidence and verifies', () => {
  const receipt = createReplayReceipt(session(), { runId: 'run_test', sourceCommit: 'abc123' });
  assert.equal(receipt.evidenceLevel, 'E2');
  assert.equal(receipt.admittedCount, 1);
  assert.equal(receipt.deterministic, true);
  assert.equal(verifyReplayReceipt(receipt).ok, true);
});

test('receipt verification rejects mismatched deterministic digests', () => {
  const receipt = createReplayReceipt(session(), { runId: 'run_test', sourceCommit: 'abc123' });
  receipt.secondRunDigest = 'tampered';
  const report = verifyReplayReceipt(receipt);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes('deterministic receipt has mismatched run digests'));
});
