import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFieldGraph } from '../src/evaluation/graph.mjs';

const scene = { width: 4, height: 3 };
const observations = [
  { id: 'obs_2', sequence: 2, sourceId: 'source_1', channel: 'heat', value: 70, status: 'measured', quality: { score: .9 }, position: { x: 2, y: 1 } },
  { id: 'obs_1', sequence: 1, sourceId: 'source_1', channel: 'heat', value: 40, status: 'measured', quality: { score: .8 }, position: { x: 1, y: 1 } },
  { id: 'obs_stale', sequence: 3, sourceId: 'source_1', channel: 'heat', value: 80, status: 'stale', quality: { score: .1 }, position: { x: 3, y: 1 } }
];

test('evaluation graph emits deterministic node receipts and publishes a field', () => {
  const options = {
    fieldId: 'field_graph_test', scene, observations, sources: new Map(), channel: 'heat',
    ticket: { sceneRevision: 1, transformRevision: 1, observationTailSequence: 2 }, gridSize: 4
  };
  const first = evaluateFieldGraph(options);
  const second = evaluateFieldGraph(options);
  assert.equal(first.artifactState, 'published');
  assert.equal(first.publication.type, 'ArtifactPublished');
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.inputObservationIds, ['obs_1', 'obs_2']);
  assert.deepEqual(first.nodes.map((node) => node.type), [
    'ObservationSelector', 'SpatialResolver', 'Estimator', 'ConfidenceEstimator', 'PublicationGate'
  ]);
  assert.equal(first.nodes[4].executionState, 'published');
  assert.equal(first.artifact.field.observationCount, 2);
});

test('evaluation graph retains a stale publication receipt without publishing old output', () => {
  const receipt = evaluateFieldGraph({
    scene,
    observations,
    sources: new Map(),
    channel: 'heat',
    ticket: { sceneRevision: 1, transformRevision: 1 },
    currentRevisions: { sceneRevision: 2, transformRevision: 1 },
    gridSize: 4
  });
  assert.equal(receipt.artifactState, 'candidate_rejected_stale');
  assert.equal(receipt.publication.type, 'ArtifactRejectedStale');
  assert.equal(receipt.nodes[4].executionState, 'rejected_stale');
  assert.equal(receipt.artifact, undefined);
  assert.equal(typeof receipt.candidateDigest, 'string');
});

test('evaluation graph enforces bounded input and grid parameters', () => {
  assert.throws(() => evaluateFieldGraph({ scene, observations, channel: 'heat', gridSize: 129 }), /gridSize/);
  assert.throws(() => evaluateFieldGraph({ scene, observations: Array.from({ length: 10001 }, () => observations[0]), channel: 'heat' }), /observation count/);
});
