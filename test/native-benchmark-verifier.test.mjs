import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNativeBenchmarkDigest,
  verifyNativeBenchmarkReceipt
} from '../src/verification/native-benchmark.mjs';

test('saved native benchmark receipt verifies after envelope extraction', () => {
  const receipt = {
    format: 'sidechannel-native-benchmark-receipt',
    formatVersion: '0.1',
    evidenceLevel: 'E2',
    tier: 'native-simulator-reference',
    runId: 'saved_fixture',
    runtimeBuildId: 'sidechannel-native-reference',
    ticks: 1,
    backends: [
      { backend: 'file', firstRunMs: 1, reopenMs: 1, packageBytes: 1, observations: 1, journalEvents: 2, independentlyVerified: true },
      { backend: 'sqlite-wal', firstRunMs: 1, reopenMs: 1, packageBytes: 1, observations: 1, journalEvents: 2, independentlyVerified: true }
    ],
    limitations: ['simulator only', 'host-local only']
  };
  receipt.receiptDigest = computeNativeBenchmarkDigest(receipt);
  assert.equal(verifyNativeBenchmarkReceipt(receipt).ok, true);
});
