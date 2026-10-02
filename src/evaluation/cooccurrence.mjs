import { createHash } from 'node:crypto';
import { normalizeIntensity } from '../contracts.mjs';
import { supportPosition } from '../spatial/support.mjs';

const MAX_OBSERVATIONS = 10_000;
const MAX_CHANNELS = 16;
const MAX_BUCKET_MS = 60_000;
const MAX_LAG_MS = 300_000;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sourcesMap(sources) {
  return sources instanceof Map ? sources : new Map((Array.isArray(sources) ? sources : []).map((source) => [source.id, source]));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeChannels(channels, observations) {
  const requested = Array.isArray(channels) && channels.length
    ? channels
    : Array.from(new Set(observations.map((observation) => observation.channel).filter((channel) => typeof channel === 'string')));
  const unique = Array.from(new Set(requested.filter((channel) => typeof channel === 'string' && channel.length > 0))).sort();
  if (unique.length < 2) throw new Error('co-occurrence requires at least two channels');
  if (unique.length > MAX_CHANNELS) throw new Error('co-occurrence channel count exceeds the bounded limit');
  return unique;
}

function normalizeRegion(region) {
  if (region === undefined || region === null) return null;
  if (!region || !finite(region.x) || !finite(region.y) || !finite(region.width) || !finite(region.height) ||
      region.x < 0 || region.y < 0 || region.width < 0 || region.height < 0 || region.width > 1000 || region.height > 1000) {
    throw new Error('co-occurrence region must be a bounded scene rectangle');
  }
  return { x: region.x, y: region.y, width: region.width, height: region.height };
}

function inRegion(position, region) {
  if (!region) return true;
  return Boolean(position) && position.x >= region.x && position.y >= region.y &&
    position.x <= region.x + region.width && position.y <= region.y + region.height;
}

function bucketSeries(observations, sources, channels, { startMs, endMs, bucketMs, region }) {
  const byChannel = new Map(channels.map((channel) => [channel, new Map()]));
  const includedIds = [];
  for (const observation of observations) {
    if (!observation || observation.status === 'stale' || observation.status === 'rejected' ||
        !channels.includes(observation.channel) || !finite(observation.timestampMs) ||
        observation.timestampMs < startMs || observation.timestampMs > endMs) continue;
    const source = sources.get(observation.sourceId);
    const position = supportPosition(observation, source);
    if (!inRegion(position, region)) continue;
    const intensity = normalizeIntensity(observation.channel, observation.value, source);
    if (!finite(intensity)) continue;
    const bucket = Math.floor(observation.timestampMs / bucketMs) * bucketMs;
    const current = byChannel.get(observation.channel).get(bucket) || { sum: 0, count: 0 };
    current.sum += intensity;
    current.count += 1;
    byChannel.get(observation.channel).set(bucket, current);
    if (typeof observation.id === 'string') includedIds.push(observation.id);
  }
  const series = new Map();
  for (const [channel, buckets] of byChannel.entries()) {
    series.set(channel, new Map(Array.from(buckets.entries(), ([bucket, value]) => [bucket, value.sum / value.count])));
  }
  return { series, includedIds };
}

function changes(series, bucketMs) {
  const ordered = Array.from(series.keys()).sort((left, right) => left - right);
  const result = new Map();
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current - previous > bucketMs * 2) continue;
    result.set(current, series.get(current) - series.get(previous));
  }
  return result;
}

function scoreLag(leftChanges, rightChanges, lagBuckets, threshold) {
  let comparableBuckets = 0;
  let coactiveBuckets = 0;
  let sameDirectionBuckets = 0;
  const strengths = [];
  for (const [leftBucket, leftDelta] of leftChanges.entries()) {
    const rightDelta = rightChanges.get(leftBucket + lagBuckets);
    if (!finite(rightDelta)) continue;
    comparableBuckets += 1;
    if (Math.abs(leftDelta) < threshold || Math.abs(rightDelta) < threshold) continue;
    coactiveBuckets += 1;
    if (Math.sign(leftDelta) === Math.sign(rightDelta)) {
      sameDirectionBuckets += 1;
      strengths.push(Math.min(1, Math.min(Math.abs(leftDelta), Math.abs(rightDelta))));
    }
  }
  const ratio = comparableBuckets ? sameDirectionBuckets / comparableBuckets : 0;
  return {
    comparableBuckets,
    coactiveBuckets,
    sameDirectionBuckets,
    supportRatio: comparableBuckets ? coactiveBuckets / comparableBuckets : 0,
    strength: strengths.length ? strengths.reduce((sum, value) => sum + value, 0) / strengths.length : 0,
    score: ratio
  };
}

function better(candidate, current) {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  if (candidate.supportRatio !== current.supportRatio) return candidate.supportRatio > current.supportRatio;
  if (candidate.strength !== current.strength) return candidate.strength > current.strength;
  return Math.abs(candidate.lagMs) < Math.abs(current.lagMs);
}

export function createCoOccurrenceArtifact({
  observations = [],
  sources = new Map(),
  channels,
  startMs = null,
  endMs = null,
  bucketMs = 1000,
  changeThreshold = 0.1,
  maxLagMs = 0,
  region = null,
  sourceSessionId = null
} = {}) {
  if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) {
    throw new Error('co-occurrence observation count exceeds the bounded limit');
  }
  if (!finite(bucketMs) || bucketMs < 50 || bucketMs > MAX_BUCKET_MS) throw new Error('co-occurrence bucketMs is out of bounds');
  if (!finite(changeThreshold) || changeThreshold < 0 || changeThreshold > 1) throw new Error('co-occurrence changeThreshold is out of bounds');
  if (!finite(maxLagMs) || maxLagMs < 0 || maxLagMs > MAX_LAG_MS) throw new Error('co-occurrence maxLagMs is out of bounds');
  const normalizedRegion = normalizeRegion(region);
  const selectedChannels = normalizeChannels(channels, observations);
  const timestamps = observations.map((observation) => observation?.timestampMs).filter(finite);
  const windowStart = finite(startMs) ? startMs : (timestamps.length ? Math.min(...timestamps) : 0);
  const windowEnd = finite(endMs) ? endMs : (timestamps.length ? Math.max(...timestamps) : windowStart);
  if (windowEnd < windowStart) throw new Error('co-occurrence window is reversed');

  const { series, includedIds } = bucketSeries(observations, sourcesMap(sources), selectedChannels, {
    startMs: windowStart,
    endMs: windowEnd,
    bucketMs,
    region: normalizedRegion
  });
  const changeSeries = new Map(selectedChannels.map((channel) => [channel, changes(series.get(channel), bucketMs)]));
  const lagBuckets = Math.floor(maxLagMs / bucketMs);
  const pairs = [];
  for (let leftIndex = 0; leftIndex < selectedChannels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedChannels.length; rightIndex += 1) {
      const leftChannel = selectedChannels[leftIndex];
      const rightChannel = selectedChannels[rightIndex];
      let best = null;
      for (let lag = -lagBuckets; lag <= lagBuckets; lag += 1) {
        const score = scoreLag(changeSeries.get(leftChannel), changeSeries.get(rightChannel), lag * bucketMs, changeThreshold);
        const candidate = { ...score, lagMs: lag * bucketMs };
        if (better(candidate, best)) best = candidate;
      }
      pairs.push({
        channels: [leftChannel, rightChannel],
        strength: Number((best?.strength || 0).toFixed(6)),
        support: {
          comparableBuckets: best?.comparableBuckets || 0,
          coactiveBuckets: best?.coactiveBuckets || 0,
          sameDirectionBuckets: best?.sameDirectionBuckets || 0,
          ratio: Number((best?.supportRatio || 0).toFixed(6))
        },
        lagEstimateMs: best?.comparableBuckets ? best.lagMs : null,
        score: Number((best?.score || 0).toFixed(6)),
        evidenceState: 'derived',
        interpretation: 'co-occurring change; not causal evidence'
      });
    }
  }
  const inputObservationIds = Array.from(new Set(includedIds));
  const artifact = {
    format: 'sidechannel-cooccurrence',
    formatVersion: '0.1',
    artifactState: 'derived',
    truthMode: 'co-occurrence',
    ...(sourceSessionId ? { sourceSessionId } : {}),
    channels: selectedChannels,
    window: { startMs: windowStart, endMs: windowEnd, bucketMs, changeThreshold, maxLagMs },
    region: clone(normalizedRegion),
    method: { id: 'bounded-change-cooccurrence', version: '1' },
    pairs,
    inputObservationIds,
    inputDigest: digest(inputObservationIds),
    provenance: {
      relation: 'derived_from',
      ...(sourceSessionId ? { sourceSessionId } : {}),
      inputObservationIds
    },
    limitations: [
      'This artifact reports bounded temporal co-occurrence of normalized changes.',
      'It does not establish causation, source identity, or physical localization accuracy.'
    ]
  };
  artifact.outputDigest = digest(artifact);
  return artifact;
}
