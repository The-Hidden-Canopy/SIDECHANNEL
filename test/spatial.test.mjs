import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateField, composeActivity, interpolateActivityField } from '../src/spatial.mjs';

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

test('unified activity field fuses channels, respects weights, and stays bounded', () => {
  const field = interpolateActivityField({
    scene: { width: 5, height: 4 },
    observations: [
      { sourceId: 'rf', channel: 'rf', value: -30, status: 'measured', quality: { score: 1 }, position: { x: 1, y: 1 } },
      { sourceId: 'heat', channel: 'heat', value: 60, status: 'measured', quality: { score: .8 }, position: { x: 4, y: 3 } },
      { sourceId: 'stale', channel: 'heat', value: 80, status: 'stale', quality: { score: 1 }, position: { x: 2, y: 2 } }
    ],
    sources: new Map(),
    weights: { rf: 2, heat: 1 },
    gridSize: 8
  });
  assert.equal(field.pointCount, 2);
  assert.ok(field.cells.some((cell) => cell.intensity !== null));
  assert.ok(field.cells.filter((cell) => cell.intensity !== null).every((cell) => cell.intensity >= 0 && cell.intensity <= 1));
  assert.ok(field.cells.filter((cell) => cell.intensity !== null).every((cell) => cell.support >= 0 && cell.support <= 1));
});

test('field value remains physical while confidence is reported separately as support', () => {
  const result = interpolateField({
    scene: { width: 2, height: 2 },
    channel: 'heat',
    observations: [{ sourceId: 'a', channel: 'heat', value: 80, status: 'measured', quality: { score: 0.1 }, position: { x: 1, y: 1 } }],
    sources: new Map(),
    gridSize: 4
  });
  const center = result.cells.reduce((closest, cell) =>
    Math.hypot(cell.x - 1, cell.y - 1) < Math.hypot(closest.x - 1, closest.y - 1) ? cell : closest
  );
  assert.ok(center.intensity > 0.9);
  assert.ok(center.support < 0.2);
  assert.equal(center.status, 'estimated');
});

test('region support is sampled as bounded geometry instead of becoming a point', () => {
  const result = interpolateField({
    scene: { width: 5, height: 4 },
    channel: 'heat',
    observations: [{
      sourceId: 'region',
      channel: 'heat',
      value: 60,
      status: 'measured',
      quality: { score: 1 },
      support: { type: 'RegionSupport', frameId: 'scene', center: { x: 2, y: 2 }, radius: 1 }
    }],
    sources: new Map(),
    gridSize: 8
  });
  assert.equal(result.observationCount, 1);
  assert.equal(result.pointCount, 5);
  assert.deepEqual(result.supportResolution.types, ['RegionSupport']);
});

test('path support contributes its bounded trajectory samples', () => {
  const result = interpolateActivityField({
    scene: { width: 5, height: 4 },
    observations: [{
      sourceId: 'mobile',
      channel: 'heat',
      value: 60,
      status: 'measured',
      quality: { score: 1 },
      support: {
        type: 'PathSupport',
        frameId: 'scene',
        points: [{ x: 1, y: 1 }, { x: 2, y: 1.5 }, { x: 3, y: 2 }]
      }
    }],
    sources: new Map(),
    gridSize: 8
  });
  assert.equal(result.observationCount, 1);
  assert.equal(result.pointCount, 3);
  assert.deepEqual(result.supportResolution.types, ['PathSupport']);
});
