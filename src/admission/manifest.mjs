import { createHash } from 'node:crypto';
import { isPlainObject } from '../contracts.mjs';

export const ADAPTER_PROTOCOL_VERSION = 'sidechannel.adapter/1';

function encode(value) {
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return createHash('sha256').update(encode(value)).digest('hex');
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function reason(id, message) {
  return { id, message };
}

export function validateProviderManifest(raw) {
  const reasons = [];
  if (!isPlainObject(raw)) return { ok: false, reasons: [reason('manifest.object', 'provider manifest must be an object')] };
  if (typeof raw.providerId !== 'string' || raw.providerId.trim().length === 0) {
    reasons.push(reason('manifest.providerId', 'providerId is required'));
  }
  if (typeof raw.providerVersion !== 'string' || raw.providerVersion.trim().length === 0) {
    reasons.push(reason('manifest.providerVersion', 'providerVersion is required'));
  }
  if (raw.protocolVersion !== ADAPTER_PROTOCOL_VERSION) {
    reasons.push(reason('manifest.protocolVersion', 'unsupported adapter protocol version'));
  }
  if (!stringArray(raw.capabilities) || raw.capabilities.length === 0) {
    reasons.push(reason('manifest.capabilities', 'at least one capability is required'));
  }
  if (raw.requiredPermissions !== undefined && !stringArray(raw.requiredPermissions)) {
    reasons.push(reason('manifest.requiredPermissions', 'requiredPermissions must be a string array'));
  }
  if (raw.supportedUnits !== undefined && !stringArray(raw.supportedUnits)) {
    reasons.push(reason('manifest.supportedUnits', 'supportedUnits must be a string array'));
  }
  if (raw.maximumRateHz !== undefined &&
      (typeof raw.maximumRateHz !== 'number' || !Number.isFinite(raw.maximumRateHz) || raw.maximumRateHz <= 0)) {
    reasons.push(reason('manifest.maximumRateHz', 'maximumRateHz must be positive and finite'));
  }
  if (raw.maximumFrameBytes !== undefined &&
      (!Number.isInteger(raw.maximumFrameBytes) || raw.maximumFrameBytes < 256 || raw.maximumFrameBytes > 2_000_000)) {
    reasons.push(reason('manifest.maximumFrameBytes', 'maximumFrameBytes must be an integer from 256 to 2000000'));
  }
  if (raw.rawContentPolicy !== undefined &&
      !['none', 'summary_only', 'explicit'].includes(raw.rawContentPolicy)) {
    reasons.push(reason('manifest.rawContentPolicy', 'rawContentPolicy is unsupported'));
  }
  if (raw.sourceIdentityPolicy !== undefined &&
      !['scene_local', 'ephemeral', 'explicit'].includes(raw.sourceIdentityPolicy)) {
    reasons.push(reason('manifest.sourceIdentityPolicy', 'sourceIdentityPolicy is unsupported'));
  }
  if (reasons.length) return { ok: false, reasons };

  const manifest = {
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerId: raw.providerId,
    providerVersion: raw.providerVersion,
    providerDigest: typeof raw.providerDigest === 'string' && raw.providerDigest.length
      ? raw.providerDigest
      : digest({ providerId: raw.providerId, providerVersion: raw.providerVersion }),
    capabilities: raw.capabilities.slice(),
    requiredPermissions: (raw.requiredPermissions || []).slice(),
    retentionPolicy: isPlainObject(raw.retentionPolicy) ? { ...raw.retentionPolicy } : { raw: 'disabled' },
    rawContentPolicy: raw.rawContentPolicy || 'none',
    sourceIdentityPolicy: raw.sourceIdentityPolicy || 'scene_local',
    supportedUnits: (raw.supportedUnits || []).slice(),
    maximumRateHz: raw.maximumRateHz || 10,
    maximumFrameBytes: raw.maximumFrameBytes || 64_000
  };
  return { ok: true, manifest };
}

export function createProviderManifest({
  providerId,
  providerVersion = '0.1.0',
  capabilities = ['normalized_observation'],
  requiredPermissions = [],
  supportedUnits = [],
  rawContentPolicy = 'none',
  sourceIdentityPolicy = 'scene_local'
} = {}) {
  const result = validateProviderManifest({
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerId,
    providerVersion,
    capabilities,
    requiredPermissions,
    supportedUnits,
    rawContentPolicy,
    sourceIdentityPolicy
  });
  if (!result.ok) throw new Error(result.reasons.map((item) => item.message).join('; '));
  return result.manifest;
}
