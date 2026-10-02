import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderManifest, validateProviderManifest } from '../src/admission/manifest.mjs';

test('provider manifests are versioned, bounded, and digestable', () => {
  const manifest = createProviderManifest({
    providerId: 'fixture.temperature',
    capabilities: ['temperature'],
    supportedUnits: ['C']
  });
  assert.equal(manifest.protocolVersion, 'sidechannel.adapter/1');
  assert.equal(manifest.providerDigest.length, 64);
  assert.equal(validateProviderManifest(manifest).ok, true);
});

test('provider manifest admission rejects unsupported protocol and oversized frames', () => {
  const result = validateProviderManifest({
    protocolVersion: 'sidechannel.adapter/99',
    providerId: 'bad',
    providerVersion: '1',
    capabilities: ['temperature'],
    maximumFrameBytes: 3_000_000
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'manifest.protocolVersion'));
  assert.ok(result.reasons.some((reason) => reason.id === 'manifest.maximumFrameBytes'));
});

test('provider manifest admission rejects unsupported identity policy', () => {
  const result = validateProviderManifest({
    protocolVersion: 'sidechannel.adapter/1',
    providerId: 'bad.identity',
    providerVersion: '1',
    capabilities: ['temperature'],
    sourceIdentityPolicy: 'unbounded'
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'manifest.sourceIdentityPolicy'));
});
