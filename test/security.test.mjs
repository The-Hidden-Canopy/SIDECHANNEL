import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, isAllowedLoopbackHost, isAllowedOrigin } from '../src/security.mjs';

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
