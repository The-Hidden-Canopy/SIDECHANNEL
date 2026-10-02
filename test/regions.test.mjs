import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_UNITS, validateRegion, validateRegions } from '../src/spatial/regions.mjs';

test('scene units stay within the portable coordinate contract', () => {
  assert.deepEqual(SCENE_UNITS, ['m', 'ft', 'px']);
});

test('scene regions accept bounded room polygons and normalize defaults', () => {
  const result = validateRegion({
    name: 'Workbench',
    points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }]
  }, { width: 5, height: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.region.kind, 'zone');
  assert.equal(result.region.color, '#6ce4db');
  assert.equal(result.region.points.length, 4);
});

test('scene regions fail closed for unsupported geometry and out-of-bounds points', () => {
  const result = validateRegions([
    { id: 'room', name: 'Room', kind: 'room', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: 'zone', name: 'Zone', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 1 }] }
  ], { width: 5, height: 4 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'region.points'));
  assert.ok(result.reasons.some((reason) => reason.id === 'region.bounds'));
});
