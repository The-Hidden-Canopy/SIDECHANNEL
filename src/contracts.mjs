export const CHANNELS = Object.freeze([
  'rf',
  'magnetic',
  'heat',
  'vibration',
  'sound',
  'network',
  'electrical',
  'bluetooth',
  'light_flicker'
]);

export const CHANNEL_LABELS = Object.freeze({
  rf: 'RF',
  magnetic: 'Magnetic field',
  heat: 'Heat',
  vibration: 'Vibration',
  sound: 'Sound features',
  network: 'Network rate',
  electrical: 'Electrical load',
  bluetooth: 'Bluetooth aggregate',
  light_flicker: 'Light flicker'
});

export const CHANNEL_RANGES = Object.freeze({
  rf: [-120, 0],
  magnetic: [0, 200],
  heat: [-20, 80],
  vibration: [0, 1],
  sound: [0, 1],
  network: [0, 100000],
  electrical: [0, 5000],
  bluetooth: [0, 100],
  light_flicker: [0, 1]
});

export const OBSERVATION_STATUSES = Object.freeze([
  'measured',
  'derived',
  'inferred',
  'stale',
  'rejected'
]);

export const EVIDENCE_STATES = Object.freeze([
  'measured',
  'derived',
  'inferred',
  'simulated',
  'imported',
  'stale',
  'rejected',
  'unknown'
]);

export const PRIVACY_CLASSES = Object.freeze([
  'summary_only',
  'local_numeric',
  'derived_feature_only',
  'raw_ephemeral',
  'raw_retained_explicit',
  'prohibited'
]);

export const PRIVACY_MODES = Object.freeze([
  'summary_only',
  'local_numeric',
  'raw_disabled',
  'provider_declared'
]);

export function privacyClassForSource(source) {
  if (source?.privacyClass && PRIVACY_CLASSES.includes(source.privacyClass)) return source.privacyClass;
  if (source?.privacyMode === 'summary_only') return 'summary_only';
  if (source?.privacyMode === 'raw_disabled') return 'derived_feature_only';
  return 'local_numeric';
}

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function createQuality(score = 1, state = 'good', reasons = []) {
  return {
    score: clamp(Number.isFinite(score) ? score : 0),
    state,
    reasons: Array.isArray(reasons) ? reasons.slice() : []
  };
}

export function magnitude(value) {
  if (Array.isArray(value)) {
    return Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  }
  return value;
}

export function channelRange(channel, source) {
  if (source && Array.isArray(source.range) && source.range.length === 2) {
    return source.range;
  }
  return CHANNEL_RANGES[channel] || [0, 1];
}

export function normalizeIntensity(channel, value, source) {
  const numeric = magnitude(value);
  if (!Number.isFinite(numeric)) return 0;
  const range = channelRange(channel, source);
  return clamp((numeric - range[0]) / Math.max(range[1] - range[0], Number.EPSILON));
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
