import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevisionTicket, evaluateFieldCandidate, publishCandidate } from '../src/evaluation/publication.mjs';

const scene = { width: 4, height: 3 };
const observations = [{
  id: 'obs_1', sourceId: 'source_1', channel: 'heat', value: 40,
  status: 'measured', quality: { score: 0.8 }, position: { x: 1, y: 1 }
}];

test('matching revisions publish a field candidate with lineage', () => {
  const ticket = createRevisionTicket({ sceneRevision: 1, observationTailSequence: 4 });
  const candidate = evaluateFieldCandidate({
    fieldId: 'field_1', scene, observations, sources: new Map(), channel: 'heat', ticket, gridSize: 4
  });
  const result = publishCandidate(candidate, ticket);
  assert.equal(result.published, true);
  assert.deepEqual(result.artifact.inputObservationIds, ['obs_1']);
  assert.equal(result.artifact.field.cells[0].status, 'estimated');
});

test('changed transform revision rejects a stale candidate instead of publishing it', () => {
  const ticket = createRevisionTicket({ sceneRevision: 1, transformRevision: 2 });
  const candidate = evaluateFieldCandidate({
    scene, observations, sources: new Map(), channel: 'heat', ticket, gridSize: 4
  });
  const result = publishCandidate(candidate, { ...ticket, transformRevision: 3 });
  assert.equal(result.published, false);
  assert.equal(result.receipt.type, 'ArtifactRejectedStale');
  assert.equal(result.receipt.reasons[0].id, 'revision.transformRevision');
});
