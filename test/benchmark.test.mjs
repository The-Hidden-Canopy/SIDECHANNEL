import test from 'node:test';
import assert from 'node:assert/strict';
import { runSoftwareBenchmark, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

test('software benchmark emits a bounded E2 receipt with deterministic replay', () => {
  const receipt = runSoftwareBenchmark({ ticks: 2, gridSize: 4, runId: 'benchmark_test', seed: 1337 });
  assert.equal(receipt.evidenceLevel, 'E2');
  assert.equal(receipt.admittedCount, 18);
  assert.equal(receipt.rejectedCount, 0);
  assert.equal(receipt.fieldCellCount, 12);
  assert.equal(receipt.replay.deterministic, true);
  assert.equal(typeof receipt.receiptDigest, 'string');
  assert.equal(verifySoftwareBenchmarkReceipt(receipt).ok, true);
  assert.ok(receipt.admissionLatencyUs.p95 >= receipt.admissionLatencyUs.p50);
  assert.ok(receipt.fieldEvaluationMs >= 0);
});

test('benchmark receipt verification detects tampering', () => {
  const receipt = runSoftwareBenchmark({ ticks: 2, gridSize: 4, runId: 'benchmark_tamper', seed: 1337 });
  receipt.admittedCount += 1;
  const verification = verifySoftwareBenchmarkReceipt(receipt);
  assert.equal(verification.ok, false);
  assert.ok(verification.reasons.includes('benchmark receipt digest mismatch'));
});

test('benchmark scales generated sources within bounded software tiers', () => {
  const receipt = runSoftwareBenchmark({ ticks: 2, gridSize: 4, sourceCount: 8, runId: 'benchmark_scale', seed: 1337 });
  assert.equal(receipt.sourceCount, 8);
  assert.equal(receipt.admittedCount, 16);
  assert.equal(verifySoftwareBenchmarkReceipt(receipt).ok, true);
});
