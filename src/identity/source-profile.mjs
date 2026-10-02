import { createHash } from 'node:crypto';

export const SOURCE_PROFILE_SCHEMA = 'sidechannel.source-profile/1';

function encode(value) {
  return JSON.stringify(value ?? null);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').slice().sort()
    : [];
}

export function sourceProfileDescriptor(source = {}) {
  const providerManifest = source.providerManifest || {};
  return {
    schema: SOURCE_PROFILE_SCHEMA,
    sourceId: typeof source.id === 'string' ? source.id : null,
    adapterType: typeof source.adapterType === 'string' ? source.adapterType : null,
    channels: stringList(source.channels),
    capabilities: stringList(source.capabilities),
    unit: typeof source.unit === 'string' ? source.unit : null,
    range: Array.isArray(source.range) && source.range.length === 2 && source.range.every(finite)
      ? source.range.slice()
      : null,
    freshnessWindowMs: finite(source.freshnessWindowMs) ? source.freshnessWindowMs : null,
    privacyMode: typeof source.privacyMode === 'string' ? source.privacyMode : null,
    privacyClass: typeof source.privacyClass === 'string' ? source.privacyClass : null,
    spatialPolicy: typeof source.spatialPolicy === 'string' ? source.spatialPolicy : null,
    poseMaxAgeMs: finite(source.poseMaxAgeMs) ? source.poseMaxAgeMs : null,
    poseFrameId: typeof source.poseFrameId === 'string' ? source.poseFrameId : null,
    providerId: typeof providerManifest.providerId === 'string' ? providerManifest.providerId : null,
    providerVersion: typeof providerManifest.providerVersion === 'string' ? providerManifest.providerVersion : null,
    providerDigest: typeof providerManifest.providerDigest === 'string' ? providerManifest.providerDigest : null,
    sourceIdentityPolicy: typeof providerManifest.sourceIdentityPolicy === 'string'
      ? providerManifest.sourceIdentityPolicy
      : null
  };
}

export function computeSourceProfileDigest(source = {}) {
  return createHash('sha256').update(encode(sourceProfileDescriptor(source))).digest('hex');
}

export function withSourceProfileDigest(source = {}) {
  return {
    ...source,
    sourceProfileDigest: computeSourceProfileDigest(source)
  };
}
