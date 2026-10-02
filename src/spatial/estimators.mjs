import { clamp, normalizeIntensity } from '../contracts.mjs';
import { interpolateField } from '../spatial.mjs';
import { resolveSupport, supportSamples } from './support.mjs';

export const ESTIMATOR_IDS = Object.freeze([
  'idw.baseline',
  'nearest-source',
  'kernel.gaussian',
  'temporal-decay',
  'region.constant',
  'vector.magnitude'
]);

const MAX_GRID_SIZE = 128;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function weight(distance, power) {
  return 1 / Math.max(distance, 0.05) ** power;
}

function pointsFor(observations, sources, channel) {
  const selected = observations.filter((observation) => observation?.channel === channel &&
    observation.status !== 'stale' && observation.status !== 'rejected');
  const points = selected.flatMap((observation) => {
    const source = sources.get(observation.sourceId);
    return supportSamples(observation, source).map(({ position, supportType }) => position ? {
      x: position.x,
      y: position.y,
      intensity: normalizeIntensity(channel, observation.value, source),
      confidence: clamp(observation.quality?.score ?? 0),
      supportType,
      timestampMs: observation.timestampMs,
      observationId: observation.id
    } : null).filter(Boolean);
  });
  return { selected, points };
}

function fieldFromPoints({ scene, points, width, height, evaluate }) {
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    const y = scene.height * (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const x = scene.width * (column + 0.5) / width;
      const result = evaluate(x, y, points);
      cells.push({ x, y, ...result });
    }
  }
  return cells;
}

function weightedCell(x, y, points, contributionFor) {
  let weighted = 0;
  let total = 0;
  let supportWeighted = 0;
  for (const point of points) {
    const contribution = contributionFor(x, y, point);
    if (!finite(contribution) || contribution <= 0) continue;
    weighted += contribution * point.intensity;
    total += contribution;
    supportWeighted += contribution * point.confidence;
  }
  return {
    intensity: total > 0 ? clamp(weighted / total) : null,
    support: total > 0 ? clamp(supportWeighted / total) : 0,
    status: total > 0 ? 'estimated' : 'insufficient_data'
  };
}

function summarize(points) {
  return {
    types: Array.from(new Set(points.map((point) => point.supportType))).sort(),
    sampleCount: points.length
  };
}

export function interpolateEstimatorField({
  estimatorId = 'idw.baseline',
  scene,
  observations = [],
  channel,
  sources = new Map(),
  gridSize = 28,
  power = 2,
  kernelSigma = 1,
  halfLifeMs = 1000,
  atTimeMs = null,
  radius = Infinity
} = {}) {
  if (!ESTIMATOR_IDS.includes(estimatorId)) throw new Error('unsupported estimator: ' + estimatorId);
  if (!scene || !finite(scene.width) || !finite(scene.height) || scene.width <= 0 || scene.height <= 0) {
    throw new Error('estimator requires a positive scene size');
  }
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > MAX_GRID_SIZE) throw new Error('estimator gridSize is out of bounds');
  if (!finite(power) || power < .5 || power > 6) throw new Error('estimator power is out of bounds');
  if (!finite(radius) || radius <= 0) radius = Infinity;
  const sourceMap = sources instanceof Map ? sources : new Map();
  const input = Array.isArray(observations) ? observations : [];
  const { selected, points } = pointsFor(input, sourceMap, channel);
  const width = Math.max(2, gridSize);
  const height = Math.max(2, Math.round(gridSize * scene.height / scene.width));
  if (estimatorId === 'idw.baseline' || estimatorId === 'vector.magnitude') {
    const field = interpolateField({ scene, observations: selected, channel, sources: sourceMap, gridSize, power, radius });
    return {
      ...field,
      estimator: { id: estimatorId, power, radius: Number.isFinite(radius) ? radius : null },
      supportResolution: summarize(points)
    };
  }
  if (estimatorId === 'kernel.gaussian' && (!finite(kernelSigma) || kernelSigma <= 0 || kernelSigma > 1000)) {
    throw new Error('kernelSigma is out of bounds');
  }
  if (estimatorId === 'temporal-decay' && (!finite(halfLifeMs) || halfLifeMs < 50 || halfLifeMs > 3_600_000)) {
    throw new Error('halfLifeMs is out of bounds');
  }
  const latestTime = selected.reduce((latest, observation) => Math.max(latest, finite(observation.timestampMs) ? observation.timestampMs : 0), 0);
  const evaluationTime = finite(atTimeMs) ? atTimeMs : latestTime;
  let cells;
  if (estimatorId === 'nearest-source') {
    cells = fieldFromPoints({
      scene, points, width, height,
      evaluate: (x, y, values) => {
        const eligible = values
          .map((point) => ({ point, distance: Math.hypot(x - point.x, y - point.y) }))
          .filter((item) => item.distance <= radius)
          .sort((left, right) => left.distance - right.distance || String(left.point.observationId).localeCompare(String(right.point.observationId)));
        const nearest = eligible[0]?.point;
        return nearest ? { intensity: nearest.intensity, support: nearest.confidence, status: 'estimated' } :
          { intensity: null, support: 0, status: 'insufficient_data' };
      }
    });
  } else if (estimatorId === 'kernel.gaussian') {
    cells = fieldFromPoints({
      scene, points, width, height,
      evaluate: (x, y, values) => weightedCell(x, y, values, (cellX, cellY, point) => {
        const distance = Math.hypot(cellX - point.x, cellY - point.y);
        if (distance > radius) return 0;
        return Math.exp(-(distance * distance) / (2 * kernelSigma * kernelSigma));
      })
    });
  } else if (estimatorId === 'temporal-decay') {
    cells = fieldFromPoints({
      scene, points, width, height,
      evaluate: (x, y, values) => weightedCell(x, y, values, (cellX, cellY, point) => {
        const distance = Math.hypot(cellX - point.x, cellY - point.y);
        if (distance > radius) return 0;
        const age = Math.max(0, evaluationTime - (finite(point.timestampMs) ? point.timestampMs : evaluationTime));
        return weight(distance, power) * Math.exp(-age / halfLifeMs);
      })
    });
  } else {
    cells = fieldFromPoints({
      scene, points: points.filter((point) => {
        const observation = selected.find((item) => item.id === point.observationId);
        const support = resolveSupport(observation, sourceMap.get(observation?.sourceId));
        return support.type === 'RegionSupport';
      }), width, height,
      evaluate: (x, y, values) => weightedCell(x, y, values, (cellX, cellY, point) => {
        const observation = selected.find((item) => item.id === point.observationId);
        const support = resolveSupport(observation, sourceMap.get(observation?.sourceId));
        const center = support.center || support.position;
        const regionRadius = support.radius;
        if (!center || !finite(regionRadius) || Math.hypot(cellX - center.x, cellY - center.y) > regionRadius) return 0;
        return 1;
      })
    });
  }
  return {
    width,
    height,
    cells,
    pointCount: points.length,
    observationCount: selected.length,
    supportResolution: summarize(points),
    estimator: {
      id: estimatorId,
      power,
      kernelSigma: estimatorId === 'kernel.gaussian' ? kernelSigma : undefined,
      halfLifeMs: estimatorId === 'temporal-decay' ? halfLifeMs : undefined,
      atTimeMs: estimatorId === 'temporal-decay' ? evaluationTime : undefined,
      radius: Number.isFinite(radius) ? radius : null
    }
  };
}
