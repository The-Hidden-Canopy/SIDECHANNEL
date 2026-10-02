import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createDefaultScene, createSimulator, DEFAULT_SOURCES } from '../simulator.mjs';
import { interpolateActivityField } from '../spatial.mjs';
import { validateObservation } from '../validation.mjs';
import { SCHEMA_SET_DIGEST } from '../schema.mjs';
import { createReplayReceipt, verifyReplayReceipt } from './receipt.mjs';

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * fraction));
  return Number(sorted[index].toFixed(3));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function benchmarkSources(scene, sourceCount) {
  if (sourceCount === DEFAULT_SOURCES.length) {
    return DEFAULT_SOURCES.map((source) => ({ ...source, position: { ...source.position } }));
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(sourceCount * scene.width / scene.height)));
  const rows = Math.ceil(sourceCount / columns);
  return Array.from({ length: sourceCount }, (_, index) => {
    const base = DEFAULT_SOURCES[index % DEFAULT_SOURCES.length];
    return {
      ...base,
      id: base.id + '_' + index,
      name: base.name + ' ' + (index + 1),
      position: {
        x: ((index % columns) + 0.5) * scene.width / columns,
        y: (Math.floor(index / columns) + 0.5) * scene.height / rows,
        uncertaintyRadius: base.position.uncertaintyRadius
      }
    };
  });
}

export function runSoftwareBenchmark({
  ticks = 8,
  gridSize = 14,
  sourceCount = DEFAULT_SOURCES.length,
  seed = 1337,
  runId = 'benchmark_' + Date.now(),
  sourceCommit = 'unknown'
} = {}) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000) throw new Error('ticks must be between 1 and 10000');
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 256) throw new Error('gridSize must be between 2 and 256');
  if (!Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 512) throw new Error('sourceCount must be between 1 and 512');

  const sceneBase = createDefaultScene();
  const sources = benchmarkSources(sceneBase, sourceCount);
  const scene = {
    ...sceneBase,
    sources,
    placements: sources.map((source) => ({
      sourceId: source.id,
      position: { ...source.position },
      calibrationState: 'calibrated',
      calibratedAtMs: 0
    }))
  };
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
  const receipt = {
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
    sourceCount,
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
  receipt.receiptDigest = digest(receipt);
  return receipt;
}

export function verifySoftwareBenchmarkReceipt(receipt) {
  const reasons = [];
  if (!receipt || receipt.format !== 'sidechannel-benchmark-receipt') reasons.push('invalid benchmark receipt format');
  if (receipt?.formatVersion !== '0.1') reasons.push('unsupported benchmark receipt version');
  if (receipt?.evidenceLevel !== 'E2') reasons.push('benchmark receipt must be E2');
  if (receipt?.tier !== 'simulator-reference') reasons.push('benchmark receipt must be simulator-reference');
  for (const field of ['runId', 'sourceCommit', 'runtimeBuildId', 'schemaDigest']) {
    if (typeof receipt?.[field] !== 'string' || receipt[field].length === 0) reasons.push('missing benchmark field: ' + field);
  }
  for (const field of ['ticks', 'gridSize', 'sourceCount', 'admittedCount', 'rejectedCount', 'publishedArtifactCount', 'fieldCellCount']) {
    if (!Number.isInteger(receipt?.[field]) || receipt[field] < 0) reasons.push('invalid benchmark count: ' + field);
  }
  if (!Number.isInteger(receipt?.ticks) || receipt.ticks < 1 || receipt.ticks > 10000) reasons.push('ticks outside benchmark bounds');
  if (!Number.isInteger(receipt?.gridSize) || receipt.gridSize < 2 || receipt.gridSize > 256) reasons.push('gridSize outside benchmark bounds');
  if (!Number.isInteger(receipt?.sourceCount) || receipt.sourceCount < 1 || receipt.sourceCount > 512) reasons.push('sourceCount outside benchmark bounds');
  for (const field of ['durationMs', 'framesPerSecond', 'fieldEvaluationMs']) {
    if (!Number.isFinite(receipt?.[field]) || receipt[field] < 0) reasons.push('invalid benchmark metric: ' + field);
  }
  const latency = receipt?.admissionLatencyUs;
  if (!latency || !['p50', 'p95', 'p99'].every((field) => Number.isFinite(latency[field]) && latency[field] >= 0)) {
    reasons.push('invalid admission latency metrics');
  } else if (!(latency.p50 <= latency.p95 && latency.p95 <= latency.p99)) {
    reasons.push('admission latency percentiles are not monotonic');
  }
  const replay = verifyReplayReceipt(receipt?.replay);
  if (!replay.ok) reasons.push(...replay.reasons.map((reason) => 'replay: ' + reason));
  if (receipt?.replay?.admittedCount !== receipt?.admittedCount) reasons.push('replay admitted count mismatch');
  if (receipt?.replay?.rejectedCount !== receipt?.rejectedCount) reasons.push('replay rejected count mismatch');
  if (receipt?.replay?.deterministic !== true) reasons.push('benchmark replay is not deterministic');
  if (typeof receipt?.receiptDigest !== 'string' || receipt.receiptDigest.length !== 64) {
    reasons.push('missing benchmark receipt digest');
  } else {
    const copy = { ...receipt };
    delete copy.receiptDigest;
    if (digest(copy) !== receipt.receiptDigest) reasons.push('benchmark receipt digest mismatch');
  }
  return { ok: reasons.length === 0, reasons, receiptDigest: receipt?.receiptDigest || null };
}
