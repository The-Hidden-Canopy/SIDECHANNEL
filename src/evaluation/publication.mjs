import { createHash } from 'node:crypto';
import { interpolateField } from '../spatial.mjs';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function createRevisionTicket({
  sceneRevision = 0,
  transformRevision = 0,
  calibrationRevision = 0,
  observationTailSequence = 0,
  nodeParameterRevision = 0
} = {}) {
  return {
    sceneRevision,
    transformRevision,
    calibrationRevision,
    observationTailSequence,
    nodeParameterRevision
  };
}

export function validateRevisionTicket(ticket, current) {
  const reasons = [];
  for (const key of Object.keys(createRevisionTicket())) {
    if (ticket?.[key] !== current?.[key]) reasons.push({
      id: 'revision.' + key,
      message: key + ' changed while candidate was evaluating'
    });
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, reasons: [] };
}

export function evaluateFieldCandidate({
  fieldId,
  estimatorId = 'idw.baseline',
  estimatorVersion = '0.2.0',
  scene,
  observations,
  sources,
  channel,
  ticket,
  gridSize = 28
}) {
  const field = interpolateField({ scene, observations, channel, sources, gridSize });
  const inputObservationIds = observations
    .filter((observation) => observation.channel === channel && observation.status !== 'stale' && observation.status !== 'rejected')
    .map((observation) => observation.id)
    .filter(Boolean);
  return {
    fieldId: fieldId || 'field_' + digest({ channel, ticket, inputObservationIds }).slice(0, 16),
    channel,
    estimatorId,
    estimatorVersion,
    field,
    inputObservationIds,
    inputDigest: digest(inputObservationIds),
    revisionTicket: createRevisionTicket(ticket)
  };
}

export function publishCandidate(candidate, current) {
  const validation = validateRevisionTicket(candidate.revisionTicket, current);
  if (!validation.ok) {
    return {
      published: false,
      receipt: {
        type: 'ArtifactRejectedStale',
        fieldId: candidate.fieldId,
        reasons: validation.reasons,
        revisionTicket: candidate.revisionTicket,
        currentRevisions: createRevisionTicket(current)
      }
    };
  }
  return {
    published: true,
    artifact: { ...candidate, publicationState: 'published' },
    receipt: {
      type: 'ArtifactPublished',
      fieldId: candidate.fieldId,
      revisionTicket: candidate.revisionTicket
    }
  };
}
