import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_CLASSES, PRIVACY_MODES } from '../src/contracts.mjs';
import { validateSourcePrivacyPolicy } from '../src/privacy.mjs';

test('source privacy policy accepts the declared mode and class contract', () => {
  for (const privacyMode of PRIVACY_MODES) {
    assert.equal(validateSourcePrivacyPolicy({ privacyMode }).ok, true, privacyMode);
  }
  for (const privacyClass of PRIVACY_CLASSES) {
    assert.equal(validateSourcePrivacyPolicy({ privacyClass }).ok, true, privacyClass);
  }
});

test('source privacy policy rejects undeclared modes and classes', () => {
  const result = validateSourcePrivacyPolicy({ privacyMode: 'store_everything', privacyClass: 'unknown' });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'privacy.mode'));
  assert.ok(result.reasons.some((reason) => reason.id === 'privacy.class'));
});
