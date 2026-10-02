import { performance } from 'node:perf_hooks';
import { createDefaultScene, createSimulator, DEFAULT_SOURCES } from '../simulator.mjs';
import { interpolateActivityField } from '../spatial.mjs';
import { validateObservation } from '../validation.mjs';
import { SCHEMA_SET_DIGEST } from '../schema.mjs';
import { createReplayReceipt } from './receipt.mjs';

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * fraction));
  return Number(sorted[index].toFixed(3));
}

export function runSoftwareBenchmark({
  ticks = 8,
  gridSize = 14,
  seed = 1337,
  runId = 'benchmark_' + Date.now(),
  sourceCommit = 'unknown'
} = {}) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000) throw new Error('ticks must be between 1 and 10000');
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 256) throw new Error('gridSize must be between 2 and 256');

  const scene = createDefaultScene();
  const sources = DEFAULT_SOURCES.map((source) => ({ ...source, position: { ...source.position } }));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const admitted = [];
  const rejected = [];
  const admissionLatenciesUs = [];
  let currentTick = 0;
  const simulator = createSimulator({
    sources,
    seed,
    intervalMs: 60_000,
    clock: () => currentTick * 250,
    emit: () => {}
  });
  const startedAt = performance.now();
  for (currentTick = 0; currentTick < ticks; currentTick += 1) {
    for (const frame of simulator.step()) {
      const admissionStart = performance.now();
      const result = validateObservation(frame, { sources: sourceMap, now: currentTick * 250 });
      admissionLatenciesUs.push((performance.now() - admissionStart) * 1000);
      if (result.ok) admitted.push({ ...result.observation, sequence: admitted.length + 1 });
      else rejected.push({ id: result.id, reasons: result.reasons });
    }
  }
  const fieldStart = performance.now();
  const field = interpolateActivityField({ scene, observations: admitted, sources: sourceMap, gridSize });
  const fieldEvaluationMs = performance.now() - fieldStart;
  const durationMs = performance.now() - startedAt;
  const session = {
    id: 'benchmark_session_' + runId,
    snapshotDigest: null,
    runtimeBuildId: 'sidechannel-node-reference',
    schemaSetDigest: SCHEMA_SET_DIGEST,
    sceneSnapshot: scene,
    sourceRegistrySnapshot: sources,
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    observations: admitted,
    events: []
  };
  const replay = createReplayReceipt(session, {
    runId,
    sourceCommit,
    seed,
    rejectedCount: rejected.length,
    publishedArtifactCount: 1,
    estimatorOptions: { gridSize }
  });
  return {
    format: 'sidechannel-benchmark-receipt',
    formatVersion: '0.1',
    evidenceLevel: 'E2',
    tier: 'simulator-reference',
    runId,
    sourceCommit,
    runtimeBuildId: session.runtimeBuildId,
    schemaDigest: SCHEMA_SET_DIGEST,
    seed,
    ticks,
    gridSize,
    admittedCount: admitted.length,
    rejectedCount: rejected.length,
    publishedArtifactCount: 1,
    durationMs: Number(durationMs.toFixed(3)),
    framesPerSecond: Number((admitted.length / Math.max(durationMs / 1000, 0.000001)).toFixed(3)),
    admissionLatencyUs: {
      p50: percentile(admissionLatenciesUs, 0.5),
      p95: percentile(admissionLatenciesUs, 0.95),
      p99: percentile(admissionLatenciesUs, 0.99)
    },
    fieldEvaluationMs: Number(fieldEvaluationMs.toFixed(3)),
    fieldCellCount: field.cells.length,
    replay,
    limitations: [
      'E2 simulator receipt only; no physical source or third-party data was exercised.',
      'Throughput and latency are host-local measurements, not production capacity claims.'
    ]
  };
}
