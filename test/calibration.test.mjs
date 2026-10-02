import test from 'node:test';
import assert from 'node:assert/strict';
import { CalibrationRegistry } from '../src/calibration/registry.mjs';

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
