import {
  CHANNELS,
  EVIDENCE_STATES,
  OBSERVATION_STATUSES,
  PRIVACY_CLASSES,
  channelRange,
  createQuality,
  isPlainObject,
  privacyClassForSource
} from './contracts.mjs';
import { normalizeProvenance } from './provenance/graph.mjs';
import { validateSpatialSupport } from './spatial/support.mjs';
import { OBSERVATION_SCHEMA } from './schema.mjs';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteValue(value) {
  return finite(value) || (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 3 &&
    value.every(finite)
  );
}

function reason(id, message) {
  return { id, message };
}

export function validateObservation(raw, options = {}) {
  const now = options.now ?? Date.now();
  const sources = options.sources instanceof Map ? options.sources : new Map();
  const reasons = [];
  const value = raw && raw.value;
  const sourceId = raw && raw.sourceId;
  const channel = raw && raw.channel;
  const id = raw && typeof raw.id === 'string' ? raw.id : 'unknown';
  const source = sources.get(sourceId);

  if (!isPlainObject(raw)) {
    return { ok: false, id, reasons: [reason('object', 'Observation must be an object')] };
  }
  if (raw.schema !== undefined && raw.schema !== OBSERVATION_SCHEMA) {
    reasons.push(reason('schema', 'Unsupported observation schema'));
  }
  if (raw.schema !== OBSERVATION_SCHEMA && !['0.1', '0.2'].includes(raw.schemaVersion)) {
    reasons.push(reason('schemaVersion', 'Unsupported schema version'));
  }
  if (typeof raw.id !== 'string' || raw.id.length < 3 || raw.id.length > 160) {
    reasons.push(reason('id', 'id must be a non-empty string'));
  }
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    reasons.push(reason('sourceId', 'sourceId is required'));
  } else if (sources.size > 0 && !sources.has(sourceId)) {
    reasons.push(reason('sourceId.unknown', 'sourceId is not registered'));
  }
  if (!CHANNELS.includes(channel)) {
    reasons.push(reason('channel', 'channel is not supported'));
  }
  if (!finite(raw.timestampMs) || raw.timestampMs < 0) {
    reasons.push(reason('timestamp', 'timestampMs must be a finite positive number'));
  } else if (raw.timestampMs > now + (options.maxFutureMs ?? 60000)) {
    reasons.push(reason('timestamp.future', 'timestampMs is too far in the future'));
  }
  if (!finiteValue(value)) {
    reasons.push(reason('value', 'value must be a finite number or vector of up to three finite numbers'));
  }
  if (typeof raw.unit !== 'string' || raw.unit.trim().length === 0) {
    reasons.push(reason('unit', 'unit is required'));
  }
  if (!OBSERVATION_STATUSES.includes(raw.status)) {
    reasons.push(reason('status', 'status is not supported'));
  }
  const evidenceState = raw.evidenceState || (source?.adapterType === 'simulator' ? 'simulated' : raw.status);
  if (!EVIDENCE_STATES.includes(evidenceState)) {
    reasons.push(reason('evidenceState', 'evidenceState is not supported'));
  }
  const privacyClass = raw.privacyClass || privacyClassForSource(source);
  if (!PRIVACY_CLASSES.includes(privacyClass)) {
    reasons.push(reason('privacyClass', 'privacyClass is not supported'));
  }
  const provenance = normalizeProvenance(raw.provenance);
  if (!provenance.ok) reasons.push(...provenance.reasons);
  const support = validateSpatialSupport(raw.support);
  if (!support.ok) reasons.push(...support.reasons);
  if (raw.quality !== undefined && !isPlainObject(raw.quality)) {
    reasons.push(reason('quality', 'quality must be an object'));
  }
  if (raw.position !== undefined) {
    if (!isPlainObject(raw.position) || !finite(raw.position.x) || !finite(raw.position.y)) {
      reasons.push(reason('position', 'position requires finite x and y coordinates'));
    }
    if (raw.position.z !== undefined && !finite(raw.position.z)) {
      reasons.push(reason('position.z', 'position.z must be finite'));
    }
    if (
      raw.position.uncertaintyRadius !== undefined &&
      (!finite(raw.position.uncertaintyRadius) || raw.position.uncertaintyRadius < 0)
    ) {
      reasons.push(reason('position.uncertaintyRadius', 'uncertaintyRadius must be non-negative'));
    }
  }

  if (finiteValue(value) && channel && sources.size > 0 && source) {
    const numeric = Array.isArray(value)
      ? Math.sqrt(value.reduce((sum, item) => sum + item * item, 0))
      : value;
    const range = channelRange(channel, source);
    if (numeric < range[0] || numeric > range[1]) {
      reasons.push(reason('value.range', 'value is outside the declared channel range'));
    }
  }

  if (reasons.length > 0) {
    return { ok: false, id, reasons };
  }

  const qualityInput = raw.quality || {};
  const quality = createQuality(
    qualityInput.score === undefined ? 1 : qualityInput.score,
    qualityInput.state || 'good',
    qualityInput.reasons || []
  );

  return {
    ok: true,
    observation: {
      schema: OBSERVATION_SCHEMA,
      schemaVersion: '0.1',
      id: raw.id,
      sourceId,
      channel,
      timestampMs: raw.timestampMs,
      receivedAtMs: finite(raw.receivedAtMs) ? raw.receivedAtMs : now,
      value,
      unit: raw.unit,
      status: raw.status,
      admissionVersion: '0.2',
      evidenceState,
      privacyClass,
      provider: {
        id: raw.providerId || source?.providerManifest?.providerId || source?.adapterType || 'unknown',
        digest: raw.providerDigest || source?.providerManifest?.providerDigest || null
      },
      quality,
      provenance: provenance.edges,
      ...(support.support ? { support: support.support } : {}),
      ...(raw.position ? { position: { ...raw.position } } : {}),
      ...(typeof raw.feature === 'string' ? { feature: raw.feature } : {}),
      ...(typeof raw.calibrationRef === 'string' ? { calibrationRef: raw.calibrationRef } : {}),
      ...(typeof raw.sourceProfileDigest === 'string' ? { sourceProfileDigest: raw.sourceProfileDigest } : {}),
      ...(typeof raw.sourceProfileRevision === 'string' ? { sourceProfileRevision: raw.sourceProfileRevision } : {}),
      ...(isPlainObject(raw.metadata) ? { metadata: { ...raw.metadata } } : {})
    }
  };
}

export function applyFreshness(observation, source, now = Date.now()) {
  if (!observation || !source) return observation;
  const ageMs = Math.max(0, now - observation.timestampMs);
  const stale = ageMs > source.freshnessWindowMs;
  if (!stale) return { ...observation, ageMs };
  return {
    ...observation,
    ageMs,
    status: observation.status === 'rejected' ? 'rejected' : 'stale',
    quality: createQuality(
      Math.min(observation.quality?.score ?? 0, 0.25),
      'stale',
      [...(observation.quality?.reasons || []), 'observation is outside freshness window']
    )
  };
}

export function isLiveObservation(observation, now = Date.now()) {
  return Boolean(
    observation &&
    observation.status !== 'rejected' &&
    observation.status !== 'stale' &&
    (!observation.ageMs || observation.ageMs >= 0) &&
    observation.timestampMs <= now
  );
}
