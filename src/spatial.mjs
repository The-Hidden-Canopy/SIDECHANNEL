import { clamp, normalizeIntensity } from './contracts.mjs';
import { supportPosition } from './spatial/support.mjs';

export function interpolateField({
  scene,
  observations,
  channel,
  sources,
  gridSize = 28,
  power = 2,
  radius = Infinity
}) {
  const width = Math.max(2, gridSize);
  const height = Math.max(2, Math.round(gridSize * scene.height / scene.width));
  const points = observations
    .filter((observation) => observation.channel === channel && observation.status !== 'stale')
    .map((observation) => {
      const source = sources.get(observation.sourceId);
      const position = supportPosition(observation, source);
      if (!position) return null;
      return {
        x: position.x,
        y: position.y,
        intensity: normalizeIntensity(channel, observation.value, source),
        confidence: clamp(observation.quality?.score ?? 0)
      };
    })
    .filter(Boolean);

  const cells = [];
  for (let row = 0; row < height; row += 1) {
    const y = scene.height * (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const x = scene.width * (column + 0.5) / width;
      let weighted = 0;
      let spatialWeightTotal = 0;
      let supportWeighted = 0;
      for (const point of points) {
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance > radius) continue;
        const weight = 1 / Math.max(distance, 0.05) ** power;
        weighted += weight * point.intensity;
        spatialWeightTotal += weight;
        supportWeighted += weight * point.confidence;
      }
      cells.push({
        x,
        y,
        intensity: spatialWeightTotal > 0 ? clamp(weighted / spatialWeightTotal) : null,
        support: spatialWeightTotal > 0 ? clamp(supportWeighted / spatialWeightTotal) : 0,
        status: spatialWeightTotal > 0 ? 'estimated' : 'insufficient_data'
      });
    }
  }
  return { width, height, cells, pointCount: points.length };
}

export function composeActivity({ scene, observations, sources, weights = {} }) {
  const channels = new Map();
  for (const observation of observations) {
    if (observation.status === 'stale' || observation.status === 'rejected') continue;
    const source = sources.get(observation.sourceId);
    const position = supportPosition(observation, source);
    if (!position) continue;
    const intensity = normalizeIntensity(observation.channel, observation.value, source);
    const score = clamp(observation.quality?.score ?? 0);
    const weight = weights[observation.channel] ?? 1;
    const key = Math.round(position.x * 10) + ':' + Math.round(position.y * 10);
    const current = channels.get(key) || { x: position.x, y: position.y, sum: 0, weight: 0 };
    current.sum += intensity * weight;
    current.weight += weight;
    current.support = (current.support || 0) + score * weight;
    channels.set(key, current);
  }
  return Array.from(channels.values()).map((item) => ({
    x: item.x,
    y: item.y,
    intensity: item.weight > 0 ? clamp(item.sum / item.weight) : 0,
    support: item.weight > 0 ? clamp(item.support / item.weight) : 0
  }));
}

export function interpolateActivityField({
  scene,
  observations,
  sources,
  weights = {},
  gridSize = 28,
  power = 2
}) {
  const width = Math.max(2, gridSize);
  const height = Math.max(2, Math.round(gridSize * scene.height / scene.width));
  const points = observations
    .filter((observation) => observation.status !== 'stale' && observation.status !== 'rejected')
    .map((observation) => {
      const source = sources.get(observation.sourceId);
      const position = supportPosition(observation, source);
      if (!position) return null;
      return {
        x: position.x,
        y: position.y,
        intensity: normalizeIntensity(observation.channel, observation.value, source),
        confidence: clamp(observation.quality?.score ?? 0),
        weight: weights[observation.channel] ?? 1
      };
    })
    .filter(Boolean);

  const cells = [];
  for (let row = 0; row < height; row += 1) {
    const y = scene.height * (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const x = scene.width * (column + 0.5) / width;
      let weighted = 0;
      let weightTotal = 0;
      let supportWeighted = 0;
      for (const point of points) {
        const distance = Math.hypot(x - point.x, y - point.y);
        const weight = 1 / Math.max(distance, 0.05) ** power;
        const contribution = weight * point.weight;
        weighted += contribution * point.intensity;
        weightTotal += contribution;
        supportWeighted += contribution * point.confidence;
      }
      cells.push({
        x,
        y,
        intensity: weightTotal > 0 ? clamp(weighted / weightTotal) : null,
        support: weightTotal > 0 ? clamp(supportWeighted / weightTotal) : 0,
        status: weightTotal > 0 ? 'estimated' : 'insufficient_data'
      });
    }
  }
  return { width, height, cells, pointCount: points.length };
}
