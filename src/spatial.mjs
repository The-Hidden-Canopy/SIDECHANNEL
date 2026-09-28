import { clamp, normalizeIntensity } from './contracts.mjs';

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
      const position = observation.position || source?.position;
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
      let weightTotal = 0;
      for (const point of points) {
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance > radius) continue;
        const weight = 1 / Math.max(distance, 0.05) ** power;
        weighted += weight * point.intensity * point.confidence;
        weightTotal += weight * point.confidence;
      }
      cells.push({
        x,
        y,
        intensity: weightTotal > 0 ? clamp(weighted / weightTotal) : null
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
    const position = observation.position || source?.position;
    if (!position) continue;
    const intensity = normalizeIntensity(observation.channel, observation.value, source);
    const score = clamp(observation.quality?.score ?? 0);
    const weight = weights[observation.channel] ?? 1;
    const key = Math.round(position.x * 10) + ':' + Math.round(position.y * 10);
    const current = channels.get(key) || { x: position.x, y: position.y, sum: 0, weight: 0 };
    current.sum += intensity * score * weight;
    current.weight += weight;
    channels.set(key, current);
  }
  return Array.from(channels.values()).map((item) => ({
    x: item.x,
    y: item.y,
    intensity: item.weight > 0 ? clamp(item.sum / item.weight) : 0
  }));
}

