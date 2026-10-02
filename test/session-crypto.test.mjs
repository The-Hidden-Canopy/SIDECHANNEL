import test from 'node:test';
import assert from 'node:assert/strict';
import { computePackageDigest } from '../src/session-verifier.mjs';
import { decryptSessionPackage, encryptSessionPackage } from '../src/session-crypto.mjs';

function packageFixture() {
  const packageData = {
    format: 'sidechannel-session',
    formatVersion: '0.2',
    sessionId: 'sess_crypto',
    scene: { id: 'scene_main', width: 2, height: 2, unit: 'm', sources: [], regions: [] },
    sceneSnapshot: { id: 'scene_main', width: 2, height: 2, unit: 'm', sources: [], regions: [] },
    sourceRegistrySnapshot: [],
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    runtimeBuildId: 'test',
    schemaSetDigest: 'schema',
    snapshotDigest: 'snapshot',
    historicalSnapshotComplete: true,
    sessionState: 'completed',
    interruptionReason: null,
    poses: [],
    journal: [],
    observations: [],
    events: [],
    createdAtMs: 1000,
    privacy: { classes: [], rawAudioIncluded: false, networkPayloadsIncluded: false, persistentDeviceIdsIncluded: false }
  };
  packageData.packageDigest = computePackageDigest(packageData);
  return packageData;
}

test('encrypted session envelopes round-trip through authenticated decryption', () => {
  const source = packageFixture();
  const envelope = encryptSessionPackage(source, 'correct horse battery staple', {
    salt: Buffer.alloc(16, 1),
    iv: Buffer.alloc(12, 2)
  });
  assert.equal(envelope.format, 'sidechannel-encrypted-session');
  assert.deepEqual(decryptSessionPackage(envelope, 'correct horse battery staple'), source);
});

test('encrypted session envelopes fail closed for wrong passphrases and tampering', () => {
  const envelope = encryptSessionPackage(packageFixture(), 'correct horse battery staple', {
    salt: Buffer.alloc(16, 3),
    iv: Buffer.alloc(12, 4)
  });
  assert.throws(() => decryptSessionPackage(envelope, 'wrong passphrase'), (error) => error.code === 'AUTH_FAILED');
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + 'AA' };
  assert.throws(() => decryptSessionPackage(tampered, 'correct horse battery staple'), (error) =>
    error.code === 'AUTH_FAILED' || error.code === 'ENVELOPE_INVALID'
  );
});

test('encryption rejects weak passphrases before creating an envelope', () => {
  assert.throws(() => encryptSessionPackage(packageFixture(), 'short'), (error) => error.code === 'PASSPHRASE_TOO_SHORT');
});
