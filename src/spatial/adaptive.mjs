import { createHash } from 'node:crypto';
import { clamp, normalizeIntensity } from '../contracts.mjs';
import { supportSamples } from './support.mjs';

const MAX_BASE_GRID = 32;
const MAX_DEPTH = 4;
const MAX_TILES = 4096;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function fieldWeight(distance, power) {
  return 1 / Math.max(distance, 0.05) ** power;
}

function buildPoints({ observations, sources, weights }) {
  return observations
    .filter((observation) => observation.status !== 'stale' && observation.status !== 'rejected')
    .flatMap((observation) => {
      const source = sources.get(observation.sourceId);
      const channelWeight = Number(weights[observation.channel] ?? 1);
      if (!finite(channelWeight) || channelWeight <= 0) return [];
      return supportSamples(observation, source).map(({ position, supportType }) => position ? {
        x: position.x,
        y: position.y,
        intensity: normalizeIntensity(observation.channel, observation.value, source),
        confidence: clamp(observation.quality?.score ?? 0),
        weight: channelWeight,
        supportType
      } : null).filter(Boolean);
    });
}

function evaluateAt(x, y, points, power) {
  let weighted = 0;
  let weightTotal = 0;
  let supportWeighted = 0;
  for (const point of points) {
    const contribution = fieldWeight(Math.hypot(x - point.x, y - point.y), power) * point.weight;
    weighted += contribution * point.intensity;
    weightTotal += contribution;
    supportWeighted += contribution * point.confidence;
  }
  return {
    intensity: weightTotal > 0 ? clamp(weighted / weightTotal) : null,
    support: weightTotal > 0 ? clamp(supportWeighted / weightTotal) : 0,
    status: weightTotal > 0 ? 'estimated' : 'insufficient_data'
  };
}

function shouldRefine(samples, threshold) {
  if (samples.some((sample) => sample.status !== 'estimated')) return false;
  const values = samples.map((sample) => sample.intensity);
  return Math.max(...values) - Math.min(...values) >= threshold;
}

export function interpolateAdaptiveActivityField({
  scene,
  observations,
  sources,
  weights = {},
  baseGrid = 4,
  maxDepth = 2,
  maxTiles = 512,
  refineThreshold = .12,
  power = 2,
  sourceSessionId = null
}) {
  if (!scene || !finite(scene.width) || !finite(scene.height) || scene.width <= 0 || scene.height <= 0) {
    throw new Error('adaptive field requires a positive scene size');
  }
  if (!Number.isInteger(baseGrid) || baseGrid < 2 || baseGrid > MAX_BASE_GRID) throw new Error('baseGrid is out of bounds');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH) throw new Error('maxDepth is out of bounds');
  if (!Number.isInteger(maxTiles) || maxTiles < baseGrid * 2 || maxTiles > MAX_TILES) throw new Error('maxTiles is out of bounds');
  if (!finite(refineThreshold) || refineThreshold < 0 || refineThreshold > 1) throw new Error('refineThreshold is out of bounds');
  if (!finite(power) || power < .5 || power > 6) throw new Error('power is out of bounds');
  const inputObservations = Array.isArray(observations) ? observations : [];
  const sourceMap = sources instanceof Map ? sources : new Map();
  const points = buildPoints({ observations: inputObservations, sources: sourceMap, weights });
  const inputObservationIds = inputObservations
    .filter((observation) => observation.status !== 'stale' && observation.status !== 'rejected')
    .map((observation) => observation.id)
    .filter((id) => typeof id === 'string');
  const columns = baseGrid;
  const rows = Math.max(2, Math.round(baseGrid * scene.height / scene.width));
  const tileLeaves = [];
  let allocatedLeaves = columns * rows;

  function visit(x, y, width, height, depth) {
    const center = evaluateAt(x + width / 2, y + height / 2, points, power);
    const probes = [
      center,
      evaluateAt(x, y, points, power),
      evaluateAt(x + width, y, points, power),
      evaluateAt(x, y + height, points, power),
      evaluateAt(x + width, y + height, points, power)
    ];
    if (depth < maxDepth && allocatedLeaves + 3 <= maxTiles && shouldRefine(probes, refineThreshold)) {
      allocatedLeaves += 3;
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      visit(x, y, halfWidth, halfHeight, depth + 1);
      visit(x + halfWidth, y, halfWidth, halfHeight, depth + 1);
      visit(x, y + halfHeight, halfWidth, halfHeight, depth + 1);
      visit(x + halfWidth, y + halfHeight, halfWidth, halfHeight, depth + 1);
      return;
    }
    tileLeaves.push({
      x,
      y,
      width,
      height,
      depth,
      intensity: center.intensity,
      support: center.support,
      status: center.status
    });
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      visit(
        scene.width * column / columns,
        scene.height * row / rows,
        scene.width / columns,
        scene.height / rows,
        0
      );
    }
  }
  return {
    format: 'sidechannel-adaptive-field',
    formatVersion: '0.1',
    width: scene.width,
    height: scene.height,
    baseGrid: { columns, rows },
    maxDepth,
    tileCount: tileLeaves.length,
    tiles: tileLeaves,
    pointCount: points.length,
    observationCount: inputObservations.filter((observation) => observation.status !== 'stale' && observation.status !== 'rejected').length,
    supportResolution: {
      types: Array.from(new Set(points.map((point) => point.supportType))).sort(),
      sampleCount: points.length
    },
    estimator: {
      id: 'adaptive-idw',
      power,
      refineThreshold,
      weights: { ...weights },
      valueAndSupportSeparate: true
    },
    inputObservationIds,
    inputDigest: digest(inputObservationIds),
    provenance: {
      relation: 'derived_from',
      ...(sourceSessionId ? { sourceSessionId } : {}),
      inputObservationIds
    },
    limitations: [
      'Adaptive tiles are a bounded software 2D presentation estimator.',
      'Tile refinement does not establish physical localization accuracy or production-scale capacity.'
    ]
  };
}
