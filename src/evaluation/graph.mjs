import { createHash } from 'node:crypto';
import { supportSamples } from '../spatial/support.mjs';
import { createRevisionTicket, evaluateFieldCandidate, publishCandidate } from './publication.mjs';

const MAX_OBSERVATIONS = 10_000;
const MAX_GRID_SIZE = 128;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function orderedObservations(observations) {
  return observations
    .map((observation, index) => ({ observation, index }))
    .sort((left, right) => {
      const leftSequence = Number.isInteger(left.observation?.sequence) ? left.observation.sequence : Number.MAX_SAFE_INTEGER;
      const rightSequence = Number.isInteger(right.observation?.sequence) ? right.observation.sequence : Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      const leftId = typeof left.observation?.id === 'string' ? left.observation.id : '';
      const rightId = typeof right.observation?.id === 'string' ? right.observation.id : '';
      if (leftId !== rightId) return leftId.localeCompare(rightId);
      return left.index - right.index;
    })
    .map(({ observation }) => observation);
}

function nodeReceipt({ id, type, parameterRevision, inputDigest, outputSummary, executionState = 'completed' }) {
  return {
    id,
    type,
    parameterRevision: String(parameterRevision),
    dependencyDigest: inputDigest,
    inputDigest,
    outputDigest: digest(outputSummary),
    executionState,
    outputSummary
  };
}

function fieldSummary(field) {
  const estimated = field.cells.filter((cell) => cell.status === 'estimated');
  const supports = estimated.map((cell) => cell.support);
  return {
    width: field.width,
    height: field.height,
    cellCount: field.cells.length,
    estimatedCellCount: estimated.length,
    insufficientCellCount: field.cells.length - estimated.length,
    minSupport: supports.length ? Math.min(...supports) : 0,
    maxSupport: supports.length ? Math.max(...supports) : 0,
    supportResolution: field.supportResolution
  };
}

export function evaluateFieldGraph({
  fieldId,
  estimatorVersion = 'idw.baseline/graph-1',
  scene,
  observations = [],
  sources = new Map(),
  channel,
  ticket = {},
  currentRevisions = ticket,
  gridSize = 28,
  parameterRevision = 1
} = {}) {
  if (!scene || !finite(scene.width) || !finite(scene.height)) throw new Error('evaluation graph requires a scene');
  if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) throw new Error('evaluation graph observation count exceeds the bounded limit');
  if (typeof channel !== 'string' || channel.length === 0) throw new Error('evaluation graph requires a channel');
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > MAX_GRID_SIZE) throw new Error('evaluation graph gridSize is out of bounds');
  const sourceMap = sources instanceof Map ? sources : new Map();
  const ordered = orderedObservations(observations);
  const selected = ordered.filter((observation) => observation?.channel === channel &&
    observation.status !== 'stale' && observation.status !== 'rejected');
  const inputObservationIds = selected.map((observation) => observation.id).filter((id) => typeof id === 'string');
  const inputDigest = digest(selected);
  const ticketValue = createRevisionTicket(ticket);
  const currentValue = createRevisionTicket(currentRevisions);
  const nodes = [];

  const selectorSummary = { channel, observationCount: selected.length, inputObservationIds };
  nodes.push(nodeReceipt({
    id: 'observation-selector',
    type: 'ObservationSelector',
    parameterRevision,
    inputDigest: digest({ channel, observations: ordered.map((observation) => observation.id || null) }),
    outputSummary: selectorSummary
  }));

  const samples = selected.flatMap((observation) => supportSamples(observation, sourceMap.get(observation.sourceId)));
  const resolverSummary = {
    observationCount: selected.length,
    sampleCount: samples.length,
    supportTypes: Array.from(new Set(samples.map((sample) => sample.supportType))).sort()
  };
  nodes.push(nodeReceipt({
    id: 'spatial-resolver',
    type: 'SpatialResolver',
    parameterRevision,
    inputDigest: digest({ inputDigest, scene: { width: scene.width, height: scene.height } }),
    outputSummary: resolverSummary
  }));

  const candidate = evaluateFieldCandidate({
    fieldId,
    estimatorId: 'idw.baseline',
    estimatorVersion,
    scene,
    observations: selected,
    sources: sourceMap,
    channel,
    ticket: ticketValue,
    gridSize
  });
  const estimatorSummary = fieldSummary(candidate.field);
  nodes.push(nodeReceipt({
    id: 'estimator',
    type: 'Estimator',
    parameterRevision,
    inputDigest: digest({ inputDigest, ticket: ticketValue, estimatorVersion, gridSize }),
    outputSummary: estimatorSummary
  }));
  nodes.push(nodeReceipt({
    id: 'confidence-estimator',
    type: 'ConfidenceEstimator',
    parameterRevision,
    inputDigest: digest(estimatorSummary),
    outputSummary: {
      valueAndSupportSeparate: true,
      minSupport: estimatorSummary.minSupport,
      maxSupport: estimatorSummary.maxSupport,
      estimatedCellCount: estimatorSummary.estimatedCellCount
    }
  }));

  const publication = publishCandidate(candidate, currentValue);
  nodes.push(nodeReceipt({
    id: 'publication-gate',
    type: 'PublicationGate',
    parameterRevision,
    inputDigest: digest({ candidate: candidate.inputDigest, ticket: ticketValue, current: currentValue }),
    executionState: publication.published ? 'published' : 'rejected_stale',
    outputSummary: {
      published: publication.published,
      receiptType: publication.receipt.type,
      reasonIds: publication.receipt.reasons?.map((reason) => reason.id) || []
    }
  }));

  const receipt = {
    format: 'sidechannel-evaluation-receipt',
    formatVersion: '0.1',
    graphId: 'field-evaluation/1',
    artifactState: publication.published ? 'published' : 'candidate_rejected_stale',
    truthMode: 'derived',
    fieldId: candidate.fieldId,
    channel,
    estimator: { id: candidate.estimatorId, version: candidate.estimatorVersion, gridSize },
    inputObservationIds,
    inputDigest,
    revisionTicket: ticketValue,
    currentRevisions: currentValue,
    nodes,
    publication: publication.receipt,
    ...(publication.published ? { artifact: publication.artifact } : {
      candidateDigest: digest(candidate),
      candidateSummary: estimatorSummary
    }),
    provenance: {
      relation: 'derived_from',
      inputObservationIds
    },
    limitations: [
      'This receipt describes a bounded deterministic software evaluation graph.',
      'Published fields are derived estimates and do not establish physical localization, causation, or hardware accuracy.'
    ]
  };
  receipt.outputDigest = digest(receipt);
  return receipt;
}
