import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, hasValidLaunchToken, isAllowedLoopbackHost, isAllowedOrigin } from '../src/security.mjs';
import { securityPostureSnapshot } from '../src/security-posture.mjs';

test('local security accepts only configured loopback hosts and origins', () => {
  assert.equal(isAllowedLoopbackHost('127.0.0.1:4173', 4173), true);
  assert.equal(isAllowedLoopbackHost('localhost:4173', 4173), true);
  assert.equal(isAllowedLoopbackHost('192.168.1.5:4173', 4173), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4173', 4173), true);
  assert.equal(isAllowedOrigin('https://127.0.0.1:4173', 4173), false);
  assert.equal(isAllowedOrigin('http://example.com:4173', 4173), false);
  assert.equal(isAllowedOrigin(undefined, 4173), true);
});

test('rate limiter bounds a connection window and resets by clock', () => {
  let now = 1000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, clock: () => now });
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), true);
  assert.equal(limiter.allow(), false);
  now = 2000;
  assert.equal(limiter.allow(), true);
});

test('launch token accepts only the current process token', () => {
  assert.equal(hasValidLaunchToken('token-1', 'token-1'), true);
  assert.equal(hasValidLaunchToken('token-2', 'token-1'), false);
  assert.equal(hasValidLaunchToken(undefined, 'token-1'), false);
  assert.equal(hasValidLaunchToken('token-1', ''), false);
});

test('security posture separates enforced local controls from external gates', () => {
  const posture = securityPostureSnapshot();
  assert.equal(posture.format, 'sidechannel-security-posture');
  assert.equal(posture.scope, 'local-software');
  assert.ok(posture.claims.some((claim) => claim.id === 'launch-token-authorization' && claim.status === 'enforced'));
  assert.ok(posture.claims.some((claim) => claim.id === 'deployment-hardening' && claim.status === 'external-gate'));
  assert.ok(posture.claims.some((claim) => claim.id === 'physical-actuation' && claim.status === 'not-supported'));
});
