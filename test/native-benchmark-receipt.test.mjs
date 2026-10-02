import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNativeBenchmarkDigest,
  verifyNativeBenchmarkReceipt
} from '../src/verification/native-benchmark.mjs';

function fixture() {
  const receipt = {
    format: 'sidechannel-native-benchmark-receipt',
    formatVersion: '0.1',
    evidenceLevel: 'E2',
    tier: 'native-simulator-reference',
    runId: 'native_benchmark_fixture',
    runtimeBuildId: 'sidechannel-native-reference',
    ticks: 8,
    backends: [
      { backend: 'file', firstRunMs: 1.2, reopenMs: 0.4, packageBytes: 123, observations: 72, journalEvents: 74, independentlyVerified: true },
      { backend: 'sqlite-wal', firstRunMs: 3.4, reopenMs: 0.8, packageBytes: 123, observations: 72, journalEvents: 74, independentlyVerified: true }
    ],
    limitations: ['simulator only', 'host-local timing only']
  };
  receipt.receiptDigest = computeNativeBenchmarkDigest(receipt);
  return receipt;
}

test('native benchmark receipt verifies its two persistence backends', () => {
  const result = verifyNativeBenchmarkReceipt(fixture());
  assert.equal(result.ok, true, result.reasons.join('; '));
});

test('native benchmark receipt detects metric tampering', () => {
  const receipt = fixture();
  receipt.backends[1].packageBytes += 1;
  const result = verifyNativeBenchmarkReceipt(receipt);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('native benchmark receipt digest mismatch'));
});
