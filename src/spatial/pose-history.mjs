import { randomUUID } from 'node:crypto';
import { isPlainObject } from '../contracts.mjs';

export const POSE_HISTORY_LIMITS = Object.freeze({
  maxSamplesPerSource: 1024,
  maxTotalSamples: 4096,
  defaultMaxAgeMs: 2000
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reason(id, message) {
  return { id, message };
}

function validatePosition(position) {
  if (!isPlainObject(position) || !finite(position.x) || !finite(position.y)) {
    return [reason('pose.position', 'pose position requires finite x and y')];
  }
  if (position.z !== undefined && !finite(position.z)) {
    return [reason('pose.position.z', 'pose position.z must be finite')];
  }
  return [];
}

export function validatePoseSample(raw = {}) {
  const reasons = [];
  if (typeof raw.sampleId !== 'string' || raw.sampleId.length < 3 || raw.sampleId.length > 160) {
    reasons.push(reason('pose.sampleId', 'sampleId must be a non-empty string'));
  }
  if (typeof raw.sourceId !== 'string' || raw.sourceId.length === 0) {
    reasons.push(reason('pose.sourceId', 'sourceId is required'));
  }
  if (!finite(raw.timestampMs) || raw.timestampMs < 0) {
    reasons.push(reason('pose.timestamp', 'timestampMs must be a finite non-negative number'));
  }
  if (typeof raw.frameId !== 'string' || raw.frameId.length === 0) {
    reasons.push(reason('pose.frameId', 'frameId is required'));
  }
  reasons.push(...validatePosition(raw.position));
  if (raw.orientation !== undefined && !isPlainObject(raw.orientation)) {
    reasons.push(reason('pose.orientation', 'orientation must be an object'));
  }
  if (raw.uncertaintyRadius !== undefined && (!finite(raw.uncertaintyRadius) || raw.uncertaintyRadius < 0)) {
    reasons.push(reason('pose.uncertainty', 'uncertaintyRadius must be non-negative and finite'));
  }
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    sample: {
      schema: 'sidechannel.pose/1',
      sampleId: raw.sampleId,
      sourceId: raw.sourceId,
      timestampMs: raw.timestampMs,
      frameId: raw.frameId,
      position: { ...raw.position },
      ...(raw.orientation ? { orientation: { ...raw.orientation } } : {}),
      ...(raw.uncertaintyRadius === undefined ? {} : { uncertaintyRadius: raw.uncertaintyRadius }),
      ...(isPlainObject(raw.provenance) ? { provenance: { ...raw.provenance } } : {})
    }
  };
}

export class PoseHistory {
  constructor({
    maxSamplesPerSource = POSE_HISTORY_LIMITS.maxSamplesPerSource,
    maxTotalSamples = POSE_HISTORY_LIMITS.maxTotalSamples,
    clock = () => Date.now()
  } = {}) {
    this.maxSamplesPerSource = maxSamplesPerSource;
    this.maxTotalSamples = maxTotalSamples;
    this.clock = clock;
    this.samples = new Map();
    this.sampleIds = new Set();
  }

  add(raw = {}) {
    const input = { ...raw, sampleId: raw.sampleId || 'pose_' + randomUUID() };
    const result = validatePoseSample(input);
    if (!result.ok) return result;
    if (this.sampleIds.has(result.sample.sampleId)) {
      return { ok: false, reasons: [reason('pose.duplicate', 'pose sampleId was already recorded')] };
    }
    const samples = this.samples.get(result.sample.sourceId) || [];
    samples.push(result.sample);
    samples.sort((left, right) => left.timestampMs - right.timestampMs || left.sampleId.localeCompare(right.sampleId));
    while (samples.length > this.maxSamplesPerSource) samples.shift();
    this.samples.set(result.sample.sourceId, samples);
    this.sampleIds.add(result.sample.sampleId);
    while (this.sampleIds.size > this.maxTotalSamples) {
      const oldest = this.list()[0];
      if (!oldest) break;
      this.remove(oldest.sampleId);
    }
    return { ok: true, sample: clone(result.sample) };
  }

  remove(sampleId) {
    for (const [sourceId, samples] of this.samples) {
      const index = samples.findIndex((sample) => sample.sampleId === sampleId);
      if (index < 0) continue;
      samples.splice(index, 1);
      if (samples.length === 0) this.samples.delete(sourceId);
      this.sampleIds.delete(sampleId);
      return true;
    }
    return false;
  }

  list(sourceId = null) {
    const values = sourceId === null
      ? Array.from(this.samples.values()).flat()
      : (this.samples.get(sourceId) || []);
    return values
      .slice()
      .sort((left, right) => left.timestampMs - right.timestampMs || left.sampleId.localeCompare(right.sampleId))
      .map(clone);
  }

  resolve(sourceId, timestampMs, { maxAgeMs = POSE_HISTORY_LIMITS.defaultMaxAgeMs, frameId = null } = {}) {
    if (!finite(timestampMs) || !finite(maxAgeMs) || maxAgeMs < 0) {
      return { ok: false, reason: reason('pose.query', 'pose query requires finite timestamp and maxAgeMs') };
    }
    const candidates = (this.samples.get(sourceId) || []).filter((sample) => !frameId || sample.frameId === frameId);
    if (candidates.length === 0) {
      return { ok: false, reason: reason('pose.missing', 'no pose sample is available for the source') };
    }
    const sample = candidates.reduce((best, current) => {
      const bestDistance = Math.abs(best.timestampMs - timestampMs);
      const currentDistance = Math.abs(current.timestampMs - timestampMs);
      return currentDistance < bestDistance ||
        (currentDistance === bestDistance && current.timestampMs < best.timestampMs)
        ? current
        : best;
    });
    const distanceMs = Math.abs(sample.timestampMs - timestampMs);
    if (distanceMs > maxAgeMs) {
      return {
        ok: false,
        reason: reason('pose.stale', 'nearest pose sample is outside the allowed temporal window'),
        sample: clone(sample),
        distanceMs
      };
    }
    return { ok: true, sample: clone(sample), distanceMs };
  }

  snapshot() {
    return {
      schema: 'sidechannel.pose-history/1',
      capturedAtMs: this.clock(),
      limits: {
        maxSamplesPerSource: this.maxSamplesPerSource,
        maxTotalSamples: this.maxTotalSamples
      },
      samples: this.list()
    };
  }
}
