import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulator, DEFAULT_SOURCES } from '../src/simulator.mjs';

test('simulator emits every configured channel deterministically for a fixed clock and seed', () => {
  const first = [];
  const second = [];
  const clock = () => 1000;
  const a = createSimulator({ emit: (item) => first.push(item), clock, seed: 7, intervalMs: 100000 });
  const b = createSimulator({ emit: (item) => second.push(item), clock, seed: 7, intervalMs: 100000 });
  a.start(); a.stop(); b.start(); b.stop();
  assert.equal(first.length, DEFAULT_SOURCES.length);
  assert.deepEqual(first.map((item) => item.value), second.map((item) => item.value));
  assert.equal(new Set(first.map((item) => item.channel)).size, DEFAULT_SOURCES.length);
});

