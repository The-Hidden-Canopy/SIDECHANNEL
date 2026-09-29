import { randomUUID } from 'node:crypto';
import { normalizeIntensity } from './contracts.mjs';

export function createEventDetector({ threshold = 0.18, cooldownMs = 1000, idFactory = () => randomUUID() } = {}) {
  const previous = new Map();
  const lastEventMs = new Map();

  return {
    observe(observation, source) {
      if (!observation || !source) return null;
      const key = observation.sourceId + ':' + observation.channel;
      const prior = previous.get(key);
      const currentIntensity = normalizeIntensity(observation.channel, observation.value, source);
      previous.set(key, { observation, intensity: currentIntensity });
      if (!prior) return null;

      const delta = Math.abs(currentIntensity - prior.intensity);
      const elapsedMs = observation.timestampMs - prior.observation.timestampMs;
      const last = lastEventMs.get(key);
      if (delta < threshold || elapsedMs < 0 || (last !== undefined && observation.timestampMs - last < cooldownMs)) {
        return null;
      }
      lastEventMs.set(key, observation.timestampMs);
      return {
        schemaVersion: '0.1',
        id: 'evt_' + idFactory(),
        type: 'activity.change',
        startMs: observation.timestampMs,
        endMs: observation.timestampMs,
        sourceId: observation.sourceId,
        channel: observation.channel,
        magnitude: Number(delta.toFixed(4)),
        from: Number(prior.intensity.toFixed(4)),
        to: Number(currentIntensity.toFixed(4)),
        position: observation.position || source.position,
        quality: observation.quality,
        metadata: { detector: 'bounded-intensity-delta', threshold }
      };
    },
    reset() {
      previous.clear();
      lastEventMs.clear();
    }
  };
}
