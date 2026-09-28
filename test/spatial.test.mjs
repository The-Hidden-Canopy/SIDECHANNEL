import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateField, composeActivity } from '../src/spatial.mjs';

test('inverse-distance field keeps source points and returns bounded intensities', () => {
  const scene = { width: 5, height: 4 };
  const observations = [
    { sourceId: 'a', channel: 'heat', value: 80, status: 'measured', quality: { score: 1 }, position: { x: 1, y: 1 } },
    { sourceId: 'b', channel: 'heat', value: 20, status: 'measured', quality: { score: 1 }, position: { x: 4, y: 3 } }
  ];
  const result = interpolateField({ scene, observations, channel: 'heat', sources: new Map(), gridSize: 8 });
  assert.equal(result.pointCount, 2);
  assert.ok(result.cells.some((cell) => cell.intensity !== null));
  assert.ok(result.cells.filter((cell) => cell.intensity !== null).every((cell) => cell.intensity >= 0 && cell.intensity <= 1));
});

test('activity composition excludes stale observations', () => {
  const activity = composeActivity({
    scene: { width: 5, height: 4 },
    observations: [
      { sourceId: 'a', channel: 'heat', value: 50, status: 'stale', quality: { score: 1 }, position: { x: 1, y: 1 } },
      { sourceId: 'b', channel: 'heat', value: 50, status: 'measured', quality: { score: 1 }, position: { x: 4, y: 3 } }
    ],
    sources: new Map()
  });
  assert.equal(activity.length, 1);
});

