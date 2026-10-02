import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_MATRIX, capabilitySnapshot } from '../src/capabilities.mjs';

test('capability matrix distinguishes implemented and gated claims', () => {
  const snapshot = capabilitySnapshot();
  assert.equal(snapshot.format, 'sidechannel-capability-matrix');
  assert.equal(snapshot.claims.length, CAPABILITY_MATRIX.length);
  assert.ok(snapshot.claims.some((claim) => claim.status === 'implemented'));
  assert.ok(snapshot.claims.some((claim) => claim.status === 'hardware-gated'));
  assert.ok(snapshot.claims.some((claim) => claim.status === 'not-supported'));
  assert.ok(snapshot.claims.every((claim) => /^E[0-5]$/.test(claim.evidenceLevel)));
});
