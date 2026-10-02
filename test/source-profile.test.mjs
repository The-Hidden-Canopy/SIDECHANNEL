import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_PROFILE_SCHEMA,
  computeSourceProfileDigest,
  sourceProfileDescriptor,
  withSourceProfileDigest
} from '../src/identity/source-profile.mjs';

test('source profile digest is stable for unordered declarations and excludes placement', () => {
  const source = {
    id: 'sensor_1',
    adapterType: 'manual',
    channels: ['heat', 'rf'],
    capabilities: ['temperature', 'band_energy'],
    unit: 'C',
    range: [-20, 80],
    freshnessWindowMs: 2000,
    privacyMode: 'local_numeric',
    position: { x: 1, y: 2 },
    providerManifest: {
      providerId: 'local:sensor_1',
      providerVersion: '0.1.0',
      providerDigest: 'provider_a'
    }
  };
  const equivalent = {
    ...source,
    channels: ['rf', 'heat'],
    capabilities: ['band_energy', 'temperature'],
    position: { x: 4, y: 3 }
  };
  assert.equal(sourceProfileDescriptor(source).schema, SOURCE_PROFILE_SCHEMA);
  assert.equal(computeSourceProfileDigest(source), computeSourceProfileDigest(equivalent));
});

test('source profile digest changes when measurement identity changes', () => {
  const source = withSourceProfileDigest({
    id: 'sensor_1',
    adapterType: 'manual',
    channels: ['heat'],
    capabilities: ['temperature'],
    unit: 'C',
    range: [-20, 80]
  });
  const changed = { ...source, unit: 'F' };
  assert.equal(source.sourceProfileDigest.length, 64);
  assert.notEqual(source.sourceProfileDigest, computeSourceProfileDigest(changed));
  assert.notEqual(computeSourceProfileDigest(source), computeSourceProfileDigest({ ...source, id: 'sensor_2' }));
});
