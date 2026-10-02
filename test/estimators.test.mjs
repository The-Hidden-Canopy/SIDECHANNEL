import test from 'node:test';
import assert from 'node:assert/strict';
import { ESTIMATOR_IDS, interpolateEstimatorField } from '../src/spatial/estimators.mjs';

const scene = { width: 5, height: 4 };
const sources = new Map([
  ['near', { id: 'near', range: [0, 100], position: { x: .5, y: .5 } }],
  ['far', { id: 'far', range: [0, 100], position: { x: 4.5, y: 3.5 } }],
  ['region', { id: 'region', range: [0, 100], position: { x: 2.5, y: 2 }, support: { type: 'RegionSupport', center: { x: 2.5, y: 2 }, radius: 1 } }]
]);
const observations = [
  { id: 'near_1', sourceId: 'near', channel: 'heat', value: 100, timestampMs: 1000, status: 'measured', quality: { score: 1 }, position: { x: .5, y: .5 } },
  { id: 'far_1', sourceId: 'far', channel: 'heat', value: 0, timestampMs: 0, status: 'measured', quality: { score: .5 }, position: { x: 4.5, y: 3.5 } },
  { id: 'region_1', sourceId: 'region', channel: 'heat', value: 50, timestampMs: 1000, status: 'measured', quality: { score: .8 },
    support: { type: 'RegionSupport', center: { x: 2.5, y: 2 }, radius: 1 } }
];

test('all bounded estimator variants return separate bounded field values and support', () => {
  for (const estimatorId of ESTIMATOR_IDS) {
    const field = interpolateEstimatorField({
      estimatorId,
      scene,
      observations,
      sources,
      channel: 'heat',
      gridSize: 6,
      kernelSigma: .8,
      halfLifeMs: 500,
      atTimeMs: 1000
    });
    assert.equal(field.estimator.id, estimatorId);
    assert.ok(field.cells.length > 0, estimatorId);
    assert.ok(field.cells.every((cell) => cell.intensity === null || (cell.intensity >= 0 && cell.intensity <= 1)), estimatorId);
    assert.ok(field.cells.every((cell) => cell.support >= 0 && cell.support <= 1), estimatorId);
  }
});

test('nearest-source and temporal-decay remain deterministic', () => {
  const options = { estimatorId: 'nearest-source', scene, observations, sources, channel: 'heat', gridSize: 6 };
  const first = interpolateEstimatorField(options);
  const second = interpolateEstimatorField(options);
  assert.deepEqual(first.cells, second.cells);
  const temporal = interpolateEstimatorField({
    ...options, estimatorId: 'temporal-decay', halfLifeMs: 100, atTimeMs: 1000
  });
  assert.equal(temporal.estimator.atTimeMs, 1000);
});

test('region estimator contributes only inside bounded region support', () => {
  const field = interpolateEstimatorField({
    estimatorId: 'region.constant', scene, observations, sources, channel: 'heat', gridSize: 6
  });
  assert.ok(field.cells.some((cell) => cell.status === 'estimated'));
  assert.ok(field.cells.some((cell) => cell.status === 'insufficient_data'));
});

test('unknown estimator and invalid parameters fail closed', () => {
  assert.throws(() => interpolateEstimatorField({ estimatorId: 'unknown', scene, observations, sources, channel: 'heat' }), /unsupported estimator/);
  assert.throws(() => interpolateEstimatorField({ estimatorId: 'kernel.gaussian', scene, observations, sources, channel: 'heat', kernelSigma: 0 }), /kernelSigma/);
  assert.throws(() => interpolateEstimatorField({ estimatorId: 'temporal-decay', scene, observations, sources, channel: 'heat', halfLifeMs: 1 }), /halfLifeMs/);
});
