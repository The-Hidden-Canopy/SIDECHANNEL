import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createDefaultScene, createSimulator, DEFAULT_SOURCES } from '../simulator.mjs';
import { interpolateActivityField } from '../spatial.mjs';
import { validateObservation } from '../validation.mjs';
import { SCHEMA_SET_DIGEST } from '../schema.mjs';
import { createIngressSequencer } from '../admission/sequencer.mjs';
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

export async function runBurstBenchmark({
  frames = 10_000,
  sourceCount = 8,
  queueCapacity = 1_024,
  seed = 1337,
  runId = 'burst_' + Date.now(),
  sourceCommit = 'unknown'
} = {}) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 10_000) throw new Error('frames must be between 1 and 10000');
  if (!Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 512) throw new Error('sourceCount must be between 1 and 512');
  if (!Number.isInteger(queueCapacity) || queueCapacity < 1 || queueCapacity > 10_000) throw new Error('queueCapacity must be between 1 and 10000');

  const sceneBase = createDefaultScene();
  const sources = benchmarkSources(sceneBase, sourceCount);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const admittedIds = [];
  const admissionLatenciesUs = [];
  let rejectedCount = 0;
  let currentTick = 0;
  const simulator = createSimulator({
    sources,
    seed,
    intervalMs: 60_000,
    clock: () => currentTick * 250,
    emit: () => {}
  });
  const ingress = createIngressSequencer({
    maxQueue: queueCapacity,
    clock: () => 0,
    process: async (frame) => {
      const admissionStart = performance.now();
      const result = validateObservation(frame, { sources: sourceMap, now: frame.timestampMs });
      admissionLatenciesUs.push((performance.now() - admissionStart) * 1000);
      if (result.ok) admittedIds.push(result.observation.id);
      else rejectedCount += 1;
      return result;
    }
  });
  const pending = [];
  const startedAt = performance.now();
  while (pending.length < frames) {
    const observations = simulator.step();
    currentTick += 1;
    for (const observation of observations) {
      if (pending.length >= frames) break;
      pending.push(ingress.enqueue(observation));
    }
  }
  await Promise.all(pending);
  const durationMs = performance.now() - startedAt;
  const ingressReceipt = ingress.receipt();
  const receipt = {
    format: 'sidechannel-burst-benchmark-receipt',
    formatVersion: '0.1',
    evidenceLevel: 'E2',
    tier: 'simulator-reference',
    runId,
    sourceCommit,
    runtimeBuildId: 'sidechannel-node-reference',
    schemaDigest: SCHEMA_SET_DIGEST,
    seed,
    requestedFrames: frames,
    sourceCount,
    queueCapacity,
    admittedCount: ingressReceipt.framesAdmitted,
    rejectedCount,
    droppedCount: ingressReceipt.framesDroppedBackpressure,
    durationMs: Number(durationMs.toFixed(3)),
    framesPerSecond: Number((frames / Math.max(durationMs / 1000, 0.000001)).toFixed(3)),
    admissionLatencyUs: {
      p50: percentile(admissionLatenciesUs, 0.5),
      p95: percentile(admissionLatenciesUs, 0.95),
      p99: percentile(admissionLatenciesUs, 0.99)
    },
    ingress: ingressReceipt,
    admittedDigest: digest(admittedIds),
    limitations: [
      'E2 simulator burst receipt only; no physical source or third-party data was exercised.',
      'Backpressure and timing are host-local software measurements, not a 10,000-frames-per-second production claim.'
    ]
  };
  receipt.receiptDigest = digest(receipt);
  return receipt;
}

export function verifyBurstBenchmarkReceipt(receipt) {
  const reasons = [];
  if (!receipt || receipt.format !== 'sidechannel-burst-benchmark-receipt') reasons.push('invalid burst receipt format');
  if (receipt?.formatVersion !== '0.1') reasons.push('unsupported burst receipt version');
  if (receipt?.evidenceLevel !== 'E2') reasons.push('burst receipt must be E2');
  if (receipt?.tier !== 'simulator-reference') reasons.push('burst receipt must be simulator-reference');
  for (const field of ['runId', 'sourceCommit', 'runtimeBuildId', 'schemaDigest', 'admittedDigest']) {
    if (typeof receipt?.[field] !== 'string' || receipt[field].length === 0) reasons.push('missing burst field: ' + field);
  }
  for (const field of ['requestedFrames', 'sourceCount', 'queueCapacity', 'admittedCount', 'rejectedCount', 'droppedCount']) {
    if (!Number.isInteger(receipt?.[field]) || receipt[field] < 0) reasons.push('invalid burst count: ' + field);
  }
  if (!Number.isInteger(receipt?.requestedFrames) || receipt.requestedFrames < 1 || receipt.requestedFrames > 10_000) reasons.push('requestedFrames outside burst bounds');
  if (!Number.isInteger(receipt?.sourceCount) || receipt.sourceCount < 1 || receipt.sourceCount > 512) reasons.push('sourceCount outside burst bounds');
  if (!Number.isInteger(receipt?.queueCapacity) || receipt.queueCapacity < 1 || receipt.queueCapacity > 10_000) reasons.push('queueCapacity outside burst bounds');
  if (receipt?.admittedCount + receipt?.rejectedCount + receipt?.droppedCount !== receipt?.requestedFrames) reasons.push('burst counts do not reconcile');
  for (const field of ['durationMs', 'framesPerSecond']) {
    if (!Number.isFinite(receipt?.[field]) || receipt[field] < 0) reasons.push('invalid burst metric: ' + field);
  }
  const latency = receipt?.admissionLatencyUs;
  if (!latency || !['p50', 'p95', 'p99'].every((field) => Number.isFinite(latency[field]) && latency[field] >= 0)) {
    reasons.push('invalid burst latency metrics');
  } else if (!(latency.p50 <= latency.p95 && latency.p95 <= latency.p99)) {
    reasons.push('burst latency percentiles are not monotonic');
  }
  const ingress = receipt?.ingress;
  if (!ingress || ingress.framesReceived !== receipt?.requestedFrames || ingress.framesAdmitted !== receipt?.admittedCount ||
      ingress.framesRejected !== receipt?.rejectedCount || ingress.framesDroppedBackpressure !== receipt?.droppedCount) {
    reasons.push('ingress receipt does not reconcile');
  }
  if (typeof receipt?.receiptDigest !== 'string' || receipt.receiptDigest.length !== 64) {
    reasons.push('missing burst receipt digest');
  } else {
    const copy = { ...receipt };
    delete copy.receiptDigest;
    if (digest(copy) !== receipt.receiptDigest) reasons.push('burst receipt digest mismatch');
  }
  return { ok: reasons.length === 0, reasons, receiptDigest: receipt?.receiptDigest || null };
}
