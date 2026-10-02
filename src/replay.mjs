import { createHash } from 'node:crypto';
import { interpolateActivityField } from './spatial.mjs';

export const REPLAY_MODES = Object.freeze({
  HISTORICAL: 'historical',
  RECOMPUTE: 'recompute',
  DETERMINISM: 'determinism'
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function requireSelfContainedSession(session) {
  if (!session?.id) throw new Error('session is required');
  if (!session.sceneSnapshot || !Array.isArray(session.sourceRegistrySnapshot)) {
    const error = new Error('session does not contain a self-contained historical snapshot');
    error.code = 'INCOMPLETE_SNAPSHOT';
    throw error;
  }
  if (!Array.isArray(session.observations) || !Array.isArray(session.events)) {
    throw new Error('session observations and events must be arrays');
  }
}

function inputDigest(session) {
  return digest({
    sessionId: session.id,
    snapshotDigest: session.snapshotDigest || null,
    observations: session.observations.map((observation) => ({
      id: observation.id,
      sequence: observation.sequence ?? null,
      timestampMs: observation.timestampMs ?? null
    }))
  });
}

export function createHistoricalReplay(session) {
  requireSelfContainedSession(session);
  const artifact = {
    format: 'sidechannel-replay',
    formatVersion: '0.1',
    mode: REPLAY_MODES.HISTORICAL,
    artifactState: 'recorded',
    truthMode: 'historical',
    sourceSessionId: session.id,
    sourceSnapshotDigest: session.snapshotDigest || null,
    scene: clone(session.sceneSnapshot),
    sources: clone(session.sourceRegistrySnapshot),
    calibrations: clone(session.calibrationRegistrySnapshot || []),
    transforms: clone(session.transformGraphSnapshot || null),
    observations: clone(session.observations),
    events: clone(session.events),
    journal: clone(session.journal || []),
    provenance: {
      relation: 'replayed_from',
      sourceSessionId: session.id,
      sourceSnapshotDigest: session.snapshotDigest || null
    }
  };
  artifact.inputDigest = inputDigest(session);
  artifact.outputDigest = digest(artifact);
  return artifact;
}

export function recomputeSession(session, {
  estimatorVersion = 'activity-field/1',
  gridSize = 28,
  power = 2,
  weights = {}
} = {}) {
  requireSelfContainedSession(session);
  const scene = clone(session.sceneSnapshot);
  const sources = new Map(session.sourceRegistrySnapshot.map((source) => [source.id, source]));
  const estimator = {
    id: 'activity-field',
    version: estimatorVersion,
    gridSize,
    power,
    weights: clone(weights)
  };
  const field = interpolateActivityField({
    scene,
    observations: session.observations,
    sources,
    weights,
    gridSize,
    power
  });
  const artifact = {
    format: 'sidechannel-replay',
    formatVersion: '0.1',
    mode: REPLAY_MODES.RECOMPUTE,
    artifactState: 'recomputed',
    truthMode: 'derived',
    sourceSessionId: session.id,
    sourceSnapshotDigest: session.snapshotDigest || null,
    inputDigest: inputDigest(session),
    estimator,
    scene,
    field,
    provenance: {
      relation: 'derived_from',
      sourceSessionId: session.id,
      sourceSnapshotDigest: session.snapshotDigest || null
    }
  };
  artifact.outputDigest = digest(artifact);
  return artifact;
}

export function verifyDeterminism(session, options = {}) {
  const first = recomputeSession(session, options);
  const second = recomputeSession(session, options);
  const report = {
    format: 'sidechannel-replay-check',
    formatVersion: '0.1',
    mode: REPLAY_MODES.DETERMINISM,
    sourceSessionId: session.id,
    estimator: first.estimator,
    firstDigest: first.outputDigest,
    secondDigest: second.outputDigest,
    ok: first.outputDigest === second.outputDigest
  };
  report.reportDigest = digest(report);
  return report;
}

export function compareRecomputedArtifacts(left, right) {
  if (left?.mode !== REPLAY_MODES.RECOMPUTE || right?.mode !== REPLAY_MODES.RECOMPUTE) {
    throw new Error('comparison requires recomputed replay artifacts');
  }
  if (left.field.width !== right.field.width || left.field.height !== right.field.height) {
    throw new Error('comparison requires matching field dimensions');
  }
  const differences = left.field.cells.map((cell, index) => {
    const other = right.field.cells[index];
    const intensityDelta = cell.intensity === null || other.intensity === null
      ? null
      : Number((cell.intensity - other.intensity).toFixed(6));
    const supportDelta = Number((cell.support - other.support).toFixed(6));
    return {
      x: cell.x,
      y: cell.y,
      intensityDelta,
      supportDelta,
      status: cell.status === other.status ? cell.status : 'changed'
    };
  });
  const changed = differences.filter((difference) =>
    Math.abs(difference.intensityDelta || 0) > 0 || Math.abs(difference.supportDelta) > 0 || difference.status === 'changed'
  );
  const artifact = {
    format: 'sidechannel-comparison',
    formatVersion: '0.1',
    artifactState: 'derived',
    truthMode: 'difference',
    sourceSessionIds: [left.sourceSessionId, right.sourceSessionId],
    estimators: [left.estimator, right.estimator],
    differenceEvidenceState: 'derived',
    metrics: {
      cellCount: differences.length,
      changedCellCount: changed.length,
      maxAbsoluteIntensityDelta: Math.max(0, ...changed.map((difference) => Math.abs(difference.intensityDelta || 0))),
      maxAbsoluteSupportDelta: Math.max(0, ...changed.map((difference) => Math.abs(difference.supportDelta)))
    },
    differences,
    provenance: {
      relation: 'derived_from',
      sourceSessionIds: [left.sourceSessionId, right.sourceSessionId]
    }
  };
  artifact.outputDigest = digest(artifact);
  return artifact;
}
