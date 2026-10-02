import test from 'node:test';
import assert from 'node:assert/strict';
import { CalibrationRegistry, assessCalibrationCompatibility } from '../src/calibration/registry.mjs';

test('calibration registry publishes immutable revisions and invalidates explicitly', () => {
  let now = 1000;
  const registry = new CalibrationRegistry({ clock: () => now });
  const record = registry.publish({
    sourceId: 'sensor_1',
    providerDigest: 'provider_digest',
    algorithmId: 'baseline.temperature',
    baselineSummary: { mean: 21.2 }
  });
  assert.equal(record.validityState, 'valid');
  assert.equal(record.revision, 1);
  now = 2000;
  const invalidated = registry.invalidate(record.calibrationId, 'source moved');
  assert.equal(invalidated.validityState, 'invalidated');
  assert.equal(invalidated.revision, 2);
  assert.equal(registry.get(record.calibrationId).invalidationReason, 'source moved');
  assert.equal(registry.digest().length, 64);
});

test('calibration compatibility requires matching provider and source profile digests', () => {
  const registry = new CalibrationRegistry({ clock: () => 1000 });
  const record = registry.publish({
    sourceId: 'sensor_1',
    providerDigest: 'provider_a',
    sourceProfileDigest: 'profile_1',
    algorithmId: 'baseline.temperature',
    expiresAtMs: 5000
  });

  assert.deepEqual(registry.assess(record.calibrationId, {
    providerDigest: 'provider_a',
    sourceProfileDigest: 'profile_1'
  }), {
    ok: true,
    status: 'compatible',
    calibrationId: record.calibrationId,
    providerDigest: 'provider_a',
    sourceProfileDigest: 'profile_1',
    reasons: []
  });

  const mismatch = registry.assess(record.calibrationId, {
    providerDigest: 'provider_b',
    sourceProfileDigest: 'profile_1'
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 'incompatible');
  assert.equal(mismatch.reasons[0].id, 'calibration.provider_digest_mismatch');

  const missing = registry.assess(record.calibrationId, { providerDigest: 'provider_a' });
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.some((reason) => reason.id === 'calibration.source_profile_digest_missing'));
});

test('calibration compatibility rejects unbound, expired, and invalidated records', () => {
  let now = 1000;
  const registry = new CalibrationRegistry({ clock: () => now });
  const record = registry.publish({
    sourceId: 'sensor_1',
    algorithmId: 'baseline.temperature',
    expiresAtMs: 2000
  });
  const unbound = registry.assess(record.calibrationId, {});
  assert.equal(unbound.ok, false);
  assert.equal(unbound.status, 'unbound');
  assert.ok(unbound.reasons.some((reason) => reason.id === 'calibration.provider_digest_unbound'));

  now = 3000;
  const expired = assessCalibrationCompatibility({
    ...record,
    providerDigest: 'provider_a',
    sourceProfileDigest: 'profile_1'
  }, { providerDigest: 'provider_a', sourceProfileDigest: 'profile_1', nowMs: now });
  assert.equal(expired.ok, false);
  assert.ok(expired.reasons.some((reason) => reason.id === 'calibration.expired'));

  registry.invalidate(record.calibrationId, 'source moved');
  const invalidated = registry.assess(record.calibrationId, {
    providerDigest: 'provider_a',
    sourceProfileDigest: 'profile_1'
  });
  assert.equal(invalidated.ok, false);
  assert.ok(invalidated.reasons.some((reason) => reason.id === 'calibration.invalid'));
});
