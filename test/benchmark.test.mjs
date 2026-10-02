import test from 'node:test';
import assert from 'node:assert/strict';
import { runBurstBenchmark, runSceneViewBenchmark, runSoftwareBenchmark, verifyBurstBenchmarkReceipt, verifySceneViewBenchmarkReceipt, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

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

test('bounded burst benchmark reconciles backpressure receipt counts', async () => {
  const receipt = await runBurstBenchmark({ frames: 200, sourceCount: 8, queueCapacity: 16, runId: 'benchmark_burst', seed: 1337 });
  assert.equal(receipt.requestedFrames, 200);
  assert.equal(receipt.admittedCount + receipt.rejectedCount + receipt.droppedCount, 200);
  assert.equal(verifyBurstBenchmarkReceipt(receipt).ok, true);
});

test('SceneView benchmark emits bounded latency and payload receipts', () => {
  const receipt = runSceneViewBenchmark({ iterations: 3, sourceCount: 8, runId: 'scene_view_test', seed: 1337 });
  assert.equal(receipt.evidenceLevel, 'E2');
  assert.equal(receipt.sceneViewFormat, 'sidechannel.scene-view/1');
  assert.equal(receipt.boundedSourceCount, 8);
  assert.equal(verifySceneViewBenchmarkReceipt(receipt).ok, true);
  receipt.payloadBytes.max += 1;
  assert.equal(verifySceneViewBenchmarkReceipt(receipt).ok, false);
});
