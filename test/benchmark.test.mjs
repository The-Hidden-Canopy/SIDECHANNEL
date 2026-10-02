import test from 'node:test';
import assert from 'node:assert/strict';
import { runSoftwareBenchmark } from '../src/verification/benchmark.mjs';

test('software benchmark emits a bounded E2 receipt with deterministic replay', () => {
  const receipt = runSoftwareBenchmark({ ticks: 2, gridSize: 4, runId: 'benchmark_test', seed: 1337 });
  assert.equal(receipt.evidenceLevel, 'E2');
  assert.equal(receipt.admittedCount, 18);
  assert.equal(receipt.rejectedCount, 0);
  assert.equal(receipt.fieldCellCount, 12);
  assert.equal(receipt.replay.deterministic, true);
  assert.ok(receipt.admissionLatencyUs.p95 >= receipt.admissionLatencyUs.p50);
  assert.ok(receipt.fieldEvaluationMs >= 0);
});
