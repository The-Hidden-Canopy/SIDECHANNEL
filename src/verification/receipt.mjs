import { createHash, randomUUID } from 'node:crypto';
import { recomputeSession, verifyDeterminism } from '../replay.mjs';

export const EVIDENCE_LEVELS = Object.freeze(['E0', 'E1', 'E2', 'E3', 'E4', 'E5']);

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function inferEvidenceLevel(session) {
  const observations = Array.isArray(session?.observations) ? session.observations : [];
  return observations.length > 0 && observations.every((observation) =>
    observation.metadata?.scenario === 'deterministic-room'
  ) ? 'E2' : 'E1';
}

export function createReplayReceipt(session, {
  runId = 'run_' + randomUUID(),
  sourceCommit = 'unknown',
  seed = null,
  rejectedCount = 0,
  publishedArtifactCount = session?.events?.length || 0,
  estimatorOptions = {}
} = {}) {
  if (!session?.id) throw new Error('session is required');
  const deterministic = verifyDeterminism(session, estimatorOptions);
  const recomputed = recomputeSession(session, estimatorOptions);
  const receipt = {
    format: 'sidechannel-replay-receipt',
    formatVersion: '0.1',
    runId,
    evidenceLevel: inferEvidenceLevel(session),
    sourceCommit,
    runtimeBuildId: session.runtimeBuildId || 'unknown',
    schemaDigest: session.schemaSetDigest || 'unknown',
    sessionDigest: session.snapshotDigest || digest({ sessionId: session.id, observations: session.observations }),
    sessionId: session.id,
    seed: seed ?? session.observations.find((observation) => observation.metadata?.seed !== undefined)?.metadata.seed ?? null,
    admittedCount: Array.isArray(session.observations) ? session.observations.length : 0,
    rejectedCount,
    publishedArtifactCount,
    firstRunDigest: deterministic.firstDigest,
    secondRunDigest: deterministic.secondDigest,
    deterministic: deterministic.ok,
    estimator: recomputed.estimator,
    limitations: [
      'This receipt exercises the software replay path only.',
      'E2 indicates the deterministic integrated simulator fixture, not physical hardware validation.'
    ]
  };
  receipt.receiptDigest = digest(receipt);
  return receipt;
}

export function verifyReplayReceipt(receipt) {
  const reasons = [];
  if (!receipt || receipt.format !== 'sidechannel-replay-receipt') reasons.push('invalid receipt format');
  if (!EVIDENCE_LEVELS.includes(receipt?.evidenceLevel)) reasons.push('unsupported evidence level');
  for (const field of ['runId', 'sourceCommit', 'runtimeBuildId', 'schemaDigest', 'sessionDigest', 'sessionId']) {
    if (typeof receipt?.[field] !== 'string' || receipt[field].length === 0) reasons.push('missing receipt field: ' + field);
  }
  for (const field of ['admittedCount', 'rejectedCount', 'publishedArtifactCount']) {
    if (!Number.isInteger(receipt?.[field]) || receipt[field] < 0) reasons.push('invalid receipt count: ' + field);
  }
  if (typeof receipt?.deterministic !== 'boolean') reasons.push('deterministic must be boolean');
  if (receipt?.deterministic && receipt.firstRunDigest !== receipt.secondRunDigest) {
    reasons.push('deterministic receipt has mismatched run digests');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    receiptDigest: receipt?.receiptDigest || null
  };
}
