import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateAdaptiveActivityField } from '../src/spatial/adaptive.mjs';

const scene = { width: 5, height: 4 };
const sources = new Map();
const observations = [
  { sourceId: 'hot', channel: 'heat', value: 80, status: 'measured', quality: { score: 1 }, position: { x: .4, y: .4 } },
  { sourceId: 'cold', channel: 'heat', value: -20, status: 'measured', quality: { score: .8 }, position: { x: 4.6, y: 3.6 } }
];

test('adaptive field refines high-variation tiles within a hard tile bound', () => {
  const base = interpolateAdaptiveActivityField({ scene, observations, sources, baseGrid: 2, maxDepth: 0 });
  const adaptive = interpolateAdaptiveActivityField({
    scene, observations, sources, baseGrid: 2, maxDepth: 2, maxTiles: 16, refineThreshold: .05
  });
  assert.equal(base.tileCount, 4);
  assert.ok(adaptive.tileCount > base.tileCount);
  assert.ok(adaptive.tileCount <= 16);
  assert.ok(adaptive.tiles.some((tile) => tile.depth > 0));
  assert.ok(adaptive.tiles.filter((tile) => tile.intensity !== null).every((tile) => tile.intensity >= 0 && tile.intensity <= 1));
  assert.ok(adaptive.tiles.every((tile) => tile.support >= 0 && tile.support <= 1));
});

test('adaptive field fails closed for empty support and invalid bounds', () => {
  const empty = interpolateAdaptiveActivityField({ scene, observations: [], sources, baseGrid: 2, maxDepth: 2 });
  assert.equal(empty.tileCount, 4);
  assert.ok(empty.tiles.every((tile) => tile.status === 'insufficient_data' && tile.intensity === null));
  assert.throws(() => interpolateAdaptiveActivityField({ scene, observations, sources, maxTiles: 3 }), /maxTiles/);
  assert.throws(() => interpolateAdaptiveActivityField({ scene, observations, sources, maxDepth: 5 }), /maxDepth/);
});
