import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFreshness, validateObservation } from '../src/validation.mjs';

const sources = new Map([[
  'sensor_1',
  { id: 'sensor_1', range: [0, 100], freshnessWindowMs: 1000 }
]]);

test('accepts a valid normalized observation', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_123',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    receivedAtMs: 1001,
    value: 22.5,
    unit: 'C',
    status: 'measured',
    quality: { score: 0.95, state: 'good', reasons: [] },
    position: { x: 1, y: 2 }
  }, { sources, now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.quality.score, 0.95);
  assert.equal(result.observation.admissionVersion, '0.2');
  assert.equal(result.observation.schema, 'sidechannel.observation/2');
  assert.equal(result.observation.evidenceState, 'measured');
  assert.equal(result.observation.privacyClass, 'local_numeric');
  assert.deepEqual(result.observation.provenance, []);
});

test('canonical observation schema is accepted without the legacy schemaVersion field', () => {
  const result = validateObservation({
    schema: 'sidechannel.observation/2',
    id: 'obs_canonical',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    value: 22,
    unit: 'C',
    status: 'measured'
  }, { sources, now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.schema, 'sidechannel.observation/2');
});

test('validation preserves explicit evidence, privacy, provider, and lineage metadata', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_lineage',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    value: 22,
    unit: 'C',
    status: 'derived',
    evidenceState: 'imported',
    privacyClass: 'derived_feature_only',
    providerId: 'fixture.temperature',
    providerDigest: 'abc',
    calibrationRef: 'cal_1',
    provenance: [{ parentId: 'obs_parent', relation: 'derived_from' }],
    support: { type: 'RegionSupport', frameId: 'scene', center: { x: 1, y: 2 }, radius: 0.5 }
  }, { sources, now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.observation.evidenceState, 'imported');
  assert.equal(result.observation.provider.id, 'fixture.temperature');
  assert.equal(result.observation.calibrationRef, 'cal_1');
  assert.equal(result.observation.provenance[0].relation, 'derived_from');
  assert.equal(result.observation.support.type, 'RegionSupport');
});

test('provider manifest identity is authoritative for admitted observations', () => {
  const manifestSources = new Map([[
    'sensor_manifest',
    {
      id: 'sensor_manifest',
      range: [0, 100],
      freshnessWindowMs: 1000,
      providerManifest: {
        providerId: 'local:sensor_manifest',
        providerDigest: 'provider_a'
      }
    }
  ]]);
  const accepted = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_manifest_ok',
    sourceId: 'sensor_manifest',
    channel: 'heat',
    timestampMs: 1000,
    value: 22,
    unit: 'C',
    status: 'measured',
    providerId: 'local:sensor_manifest',
    providerDigest: 'provider_a'
  }, { sources: manifestSources, now: 1000 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.observation.provider.digest, 'provider_a');

  const rejected = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_manifest_bad',
    sourceId: 'sensor_manifest',
    channel: 'heat',
    timestampMs: 1000,
    value: 22,
    unit: 'C',
    status: 'measured',
    providerId: 'local:sensor_manifest',
    providerDigest: 'provider_changed'
  }, { sources: manifestSources, now: 1000 });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.reasons.some((reason) => reason.id === 'provider.digest.mismatch'));
});

test('validation rejects an unsupported spatial support type', () => {
  const result = validateObservation({
    schemaVersion: '0.1', id: 'obs_support_bad', sourceId: 'sensor_1', channel: 'heat',
    timestampMs: 1000, value: 22, unit: 'C', status: 'measured',
    support: { type: 'PointMaybe' }
  }, { sources, now: 1000 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'support.type'));
});

test('rejects malformed, unknown, and out-of-range observations', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'bad',
    sourceId: 'missing',
    channel: 'heat',
    timestampMs: 1000,
    value: 101,
    unit: 'C',
    status: 'measured'
  }, { sources, now: 1000 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((item) => item.id === 'sourceId.unknown'));
});

test('marks observations stale without converting them to zero', () => {
  const result = validateObservation({
    schemaVersion: '0.1',
    id: 'obs_stale',
    sourceId: 'sensor_1',
    channel: 'heat',
    timestampMs: 1000,
    value: 20,
    unit: 'C',
    status: 'measured'
  }, { sources, now: 1000 });
  const stale = applyFreshness(result.observation, sources.get('sensor_1'), 2501);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.value, 20);
  assert.equal(stale.quality.state, 'stale');
});
