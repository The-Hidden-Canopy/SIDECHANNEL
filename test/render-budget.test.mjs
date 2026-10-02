import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBudgetForObservationCount, RENDER_BUDGET_LIMITS } from '../public/render-budget.mjs';

test('render budget keeps full detail for ordinary scene density', () => {
  assert.deepEqual(renderBudgetForObservationCount(180), {
    ...RENDER_BUDGET_LIMITS[0],
    label: 'full visual detail',
    warning: null,
    observationCount: 180
  });
});

test('render budget reduces field and overlay workload in ordered stages', () => {
  const reduced = renderBudgetForObservationCount(181);
  const conservative = renderBudgetForObservationCount(421);
  const capped = renderBudgetForObservationCount(901);
  assert.deepEqual([reduced.cols, reduced.rows, reduced.trailLimit], [18, 14, 16]);
  assert.deepEqual([conservative.cols, conservative.rows, conservative.trailLimit], [14, 11, 10]);
  assert.deepEqual([capped.cols, capped.rows, capped.trailLimit], [10, 8, 6]);
  assert.ok(reduced.warning);
  assert.ok(conservative.warning);
  assert.ok(capped.warning);
});

test('render budget treats invalid counts as an empty scene', () => {
  const budget = renderBudgetForObservationCount('not-a-count');
  assert.equal(budget.observationCount, 0);
  assert.equal(budget.warning, null);
  assert.deepEqual([budget.cols, budget.rows], [22, 18]);
});
