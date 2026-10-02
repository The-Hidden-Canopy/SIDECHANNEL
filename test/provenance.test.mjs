import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProvenance } from '../src/provenance/graph.mjs';

test('provenance normalizer keeps supported lineage edges', () => {
  const result = normalizeProvenance([
    { parentId: 'obs_parent', relation: 'measured_from' },
    { parentId: 'cal_1', relation: 'calibrated_by' }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.edges[1], { parentId: 'cal_1', relation: 'calibrated_by' });
});

test('provenance normalizer fails closed on unknown relations', () => {
  const result = normalizeProvenance([{ parentId: 'obs_parent', relation: 'caused_by' }]);
  assert.equal(result.ok, false);
  assert.equal(result.reasons[0].id, 'provenance.relation');
});
