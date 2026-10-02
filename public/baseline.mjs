export const BASELINE_SCHEMA = 'sidechannel.baseline/1';

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
  normalize
} = {}) {
  if (typeof normalize !== 'function') throw new Error('baseline normalization is required');
  const entries = latestValidObservations(observations).map((observation) => ({
    sourceId: observation.sourceId,
    channel: observation.channel,
    intensity: normalize(observation.channel, observation.value),
    timestampMs: observation.timestampMs
  }));
  return {
    schemaVersion: BASELINE_SCHEMA,
    sceneId: sceneId || null,
    capturedAtMs,
    observationCount: entries.length,
    observations: entries
  };
}

export function createBaselineIndex(snapshot) {
  return new Map((snapshot?.observations || []).map((entry) => [observationKey(entry), entry]));
}

export function baselineDelta(observation, baselineIndex, normalize) {
  if (!observation || typeof normalize !== 'function') return null;
  const reference = baselineIndex?.get(observationKey(observation));
  if (!reference || !Number.isFinite(reference.intensity)) return null;
  return normalize(observation.channel, observation.value) - reference.intensity;
}
