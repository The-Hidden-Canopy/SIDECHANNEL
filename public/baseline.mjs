export const BASELINE_SCHEMA = 'sidechannel.baseline/1';
const MINIMUM_STD_DEV = 0.05;
const Z_SCORE_LIMIT = 4;
const MAX_BASELINE_SAMPLES = 1024;

function observationKey(observation) {
  return observation.sourceId + ':' + observation.channel;
}

export function latestValidObservations(observations = []) {
  const latest = new Map();
  observations.forEach((observation) => {
    if (!observation || observation.status === 'stale' || observation.status === 'rejected') return;
    const key = observationKey(observation);
    const previous = latest.get(key);
    if (!previous || Number(observation.timestampMs || 0) >= Number(previous.timestampMs || 0)) {
      latest.set(key, observation);
    }
  });
  return Array.from(latest.values());
}

export function createBaselineSnapshot({
  sceneId,
  capturedAtMs = Date.now(),
  observations = [],
  samples = [],
  normalize
} = {}) {
  if (typeof normalize !== 'function') throw new Error('baseline normalization is required');
  const input = (samples.length
    ? samples
    : latestValidObservations(observations).map((observation) => ({
      sourceId: observation.sourceId,
      channel: observation.channel,
      value: observation.value,
      timestampMs: observation.timestampMs
    }))).slice(-MAX_BASELINE_SAMPLES);
  const grouped = new Map();
  input.forEach((sample) => {
    if (!sample || sample.status === 'stale' || sample.status === 'rejected') return;
    const value = normalize(sample.channel, sample.value);
    if (!Number.isFinite(value)) return;
    const key = observationKey(sample);
    const bucket = grouped.get(key) || [];
    bucket.push({ value, timestampMs: sample.timestampMs });
    grouped.set(key, bucket);
  });
  const entries = Array.from(grouped.entries()).map(([key, values]) => {
    const [sourceId, channel] = key.split(':');
    const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
    const variance = values.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / values.length;
    return {
      sourceId,
      channel,
      mean,
      stdDev: Math.max(Math.sqrt(variance), MINIMUM_STD_DEV),
      sampleCount: values.length,
      timestampMs: Math.max(...values.map((item) => Number(item.timestampMs || 0)))
    };
  });
  return {
    schemaVersion: BASELINE_SCHEMA,
    sceneId: sceneId || null,
    capturedAtMs,
    observationCount: entries.length,
    sampleCount: entries.reduce((sum, entry) => sum + entry.sampleCount, 0),
    zScoreLimit: Z_SCORE_LIMIT,
    observations: entries
  };
}

export function createBaselineIndex(snapshot) {
  return new Map((snapshot?.observations || []).map((entry) => [observationKey(entry), entry]));
}

export function baselineDelta(observation, baselineIndex, normalize) {
  if (!observation || typeof normalize !== 'function') return null;
  const reference = baselineIndex?.get(observationKey(observation));
  if (!reference || !Number.isFinite(reference.mean)) return null;
  const zScore = (normalize(observation.channel, observation.value) - reference.mean) /
    Math.max(reference.stdDev || MINIMUM_STD_DEV, MINIMUM_STD_DEV);
  return Math.max(-Z_SCORE_LIMIT, Math.min(Z_SCORE_LIMIT, zScore));
}
