import { createHash } from 'node:crypto';
import { createEventDetector } from '../events.mjs';
import { validateAdapterFrame } from '../adapters/protocol.mjs';
import { createProviderManifest } from '../admission/manifest.mjs';
import { AdapterSupervisor } from '../adapters/supervisor.mjs';
import { createRevisionTicket, evaluateFieldCandidate, publishCandidate } from '../evaluation/publication.mjs';
import { HashChainJournal } from '../journal.mjs';
import { validateObservation } from '../validation.mjs';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function result(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function staleCandidateCase() {
  const scene = { width: 4, height: 3 };
  const observations = [{
    id: 'fault_observation_1', sourceId: 'fault_source', channel: 'heat', value: 40,
    status: 'measured', quality: { score: 1 }, position: { x: 1, y: 1 }
  }];
  const ticket = createRevisionTicket({ sceneRevision: 1, transformRevision: 1 });
  const candidate = evaluateFieldCandidate({
    fieldId: 'fault_field', scene, observations, sources: new Map(), channel: 'heat', ticket, gridSize: 4
  });
  const publication = publishCandidate(candidate, { ...ticket, sceneRevision: 2 });
  return result('stale-candidate-publication', publication.published === false && publication.receipt.type === 'ArtifactRejectedStale', {
    receiptType: publication.receipt.type,
    reasonIds: publication.receipt.reasons.map((reason) => reason.id)
  });
}

function outOfOrderDetectorCase() {
  const detector = createEventDetector({ threshold: .1, cooldownMs: 0, idFactory: () => 'fault' });
  const source = { id: 'fault_source', range: [0, 100] };
  detector.observe({ sourceId: source.id, channel: 'heat', value: 10, timestampMs: 1000 }, source);
  const outOfOrder = detector.observe({ sourceId: source.id, channel: 'heat', value: 90, timestampMs: 900 }, source);
  const next = detector.observe({ sourceId: source.id, channel: 'heat', value: 20, timestampMs: 1100 }, source);
  return result('out-of-order-detector-baseline', outOfOrder === null && next?.from === .1 && next?.to === .2, {
    outOfOrderRejected: outOfOrder === null,
    nextFrom: next?.from ?? null,
    nextTo: next?.to ?? null
  });
}

function oversizedFrameCase() {
  const validation = validateAdapterFrame({
    protocolVersion: 'sidechannel.adapter/1',
    type: 'diagnostic',
    payload: { message: 'x'.repeat(600) }
  }, { maxBytes: 256 });
  return result('oversized-adapter-frame', validation.ok === false && validation.reasons.some((reason) => reason.id === 'frame.bytes'), {
    reasonIds: validation.reasons.map((reason) => reason.id)
  });
}

function malformedFrameCase() {
  const validation = validateAdapterFrame({ protocolVersion: 'sidechannel.adapter/0', type: 'unknown' });
  return result('malformed-adapter-frame', validation.ok === false && validation.reasons.some((reason) => reason.id === 'frame.protocolVersion') &&
    validation.reasons.some((reason) => reason.id === 'frame.type'), {
    reasonIds: validation.reasons.map((reason) => reason.id)
  });
}

function outOfRangeObservationCase() {
  const sources = new Map([['fault_source', { id: 'fault_source', range: [0, 100] }]]);
  const validation = validateObservation({
    schema: 'sidechannel.observation/2', id: 'fault_range', sourceId: 'fault_source', channel: 'heat',
    timestampMs: 1000, value: 101, unit: 'C', status: 'measured'
  }, { sources, now: 1000 });
  return result('out-of-range-observation', validation.ok === false && validation.reasons.some((reason) => reason.id === 'value.range'), {
    reasonIds: validation.reasons.map((reason) => reason.id)
  });
}

async function permissionRevocationCase() {
  const supervisor = new AdapterSupervisor({ clock: () => 1000 });
  const manifest = createProviderManifest({
    providerId: 'fault.permission',
    requiredPermissions: ['local.network.telemetry']
  });
  supervisor.register(manifest);
  supervisor.grantPermissions(manifest.providerId, manifest.requiredPermissions);
  supervisor.start(manifest.providerId);
  const revoked = await supervisor.revokePermissions(manifest.providerId, manifest.requiredPermissions);
  return result('permission-revocation-disables-provider', revoked.adapter.state === 'DISABLED' &&
    revoked.adapter.lastCancellation?.reason === 'permission_revoked', {
    state: revoked.adapter.state,
    cancellation: revoked.adapter.lastCancellation
  });
}

function journalTamperCase() {
  const journal = new HashChainJournal({ sessionId: 'fault_session', clock: () => 1000, idFactory: () => 'fault' });
  journal.append('SessionOpened', { scene: 'scene_main' });
  journal.append('ObservationAdmitted', { observationId: 'fault_observation_1' });
  const tampered = journal.events.map((event) => ({ ...event, payload: { ...event.payload } }));
  tampered[1].payload.observationId = 'changed';
  const verification = journal.verify(tampered);
  return result('journal-tail-tamper', verification.ok === false, {
    reason: verification.reason,
    index: verification.index
  });
}

function invalidSpatialGeometryCase() {
  const sources = new Map([['fault_source', { id: 'fault_source', range: [0, 100] }]]);
  const validation = validateObservation({
    schema: 'sidechannel.observation/2', id: 'fault_geometry', sourceId: 'fault_source', channel: 'heat',
    timestampMs: 1000, value: 20, unit: 'C', status: 'measured',
    support: { type: 'ConeSupport', origin: { x: 1, y: 1 }, direction: { x: 0, y: 0 }, length: 2, angleRad: .2 }
  }, { sources, now: 1000 });
  return result('invalid-spatial-geometry', validation.ok === false && validation.reasons.some((reason) => reason.id === 'support.cone.direction'), {
    reasonIds: validation.reasons.map((reason) => reason.id)
  });
}

export async function runFaultCampaign({ runId = 'faults_' + Date.now(), sourceCommit = 'unknown' } = {}) {
  const cases = [
    staleCandidateCase(),
    outOfOrderDetectorCase(),
    oversizedFrameCase(),
    malformedFrameCase(),
    outOfRangeObservationCase(),
    await permissionRevocationCase(),
    journalTamperCase(),
    invalidSpatialGeometryCase()
  ];
  const receipt = {
    format: 'sidechannel-fault-campaign-receipt',
    formatVersion: '0.1',
    evidenceLevel: 'E2',
    tier: 'simulator-reference',
    runId,
    sourceCommit,
    runtimeBuildId: 'sidechannel-node-reference',
    cases,
    caseCount: cases.length,
    passedCaseCount: cases.filter((item) => item.passed).length,
    failedCaseCount: cases.filter((item) => !item.passed).length,
    passed: cases.every((item) => item.passed),
    limitations: [
      'E2 software fault campaign only; no physical source or third-party data was exercised.',
      'Passing fault cases verifies bounded runtime behavior, not deployment, hardware, or regulated-operation readiness.'
    ]
  };
  receipt.receiptDigest = digest(receipt);
  return receipt;
}

export function verifyFaultCampaignReceipt(receipt) {
  const reasons = [];
  if (!receipt || receipt.format !== 'sidechannel-fault-campaign-receipt') reasons.push('invalid fault campaign receipt format');
  if (receipt?.formatVersion !== '0.1') reasons.push('unsupported fault campaign receipt version');
  if (receipt?.evidenceLevel !== 'E2') reasons.push('fault campaign receipt must be E2');
  if (receipt?.tier !== 'simulator-reference') reasons.push('fault campaign receipt must be simulator-reference');
  for (const field of ['runId', 'sourceCommit', 'runtimeBuildId']) {
    if (typeof receipt?.[field] !== 'string' || receipt[field].length === 0) reasons.push('missing fault campaign field: ' + field);
  }
  if (!Array.isArray(receipt?.cases) || receipt.cases.length !== receipt?.caseCount) reasons.push('fault campaign cases do not reconcile');
  if (receipt?.passedCaseCount !== receipt?.cases?.filter((item) => item?.passed).length) reasons.push('fault campaign passed count does not reconcile');
  if (receipt?.failedCaseCount !== receipt?.cases?.filter((item) => !item?.passed).length) reasons.push('fault campaign failed count does not reconcile');
  if (receipt?.passed !== (receipt?.failedCaseCount === 0)) reasons.push('fault campaign overall status does not reconcile');
  if (receipt?.cases?.some((item) => typeof item?.id !== 'string' || typeof item?.passed !== 'boolean')) reasons.push('fault campaign case shape is invalid');
  if (typeof receipt?.receiptDigest !== 'string' || receipt.receiptDigest.length !== 64) {
    reasons.push('missing fault campaign receipt digest');
  } else {
    const copy = { ...receipt };
    delete copy.receiptDigest;
    if (digest(copy) !== receipt.receiptDigest) reasons.push('fault campaign receipt digest mismatch');
  }
  return { ok: reasons.length === 0, reasons, receiptDigest: receipt?.receiptDigest || null };
}
