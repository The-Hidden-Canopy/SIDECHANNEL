import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventDetector } from '../src/events.mjs';

const source = {
  id: 'source_heat',
  range: [0, 100],
  position: { x: 1, y: 2 }
};

function item(id, timestampMs, value) {
  return {
    id,
    sourceId: source.id,
    channel: 'heat',
    timestampMs,
    value,
    unit: 'C',
    quality: { score: 1, state: 'good', reasons: [] },
    position: source.position
  };
}

test('event detector emits bounded change events and respects cooldown', () => {
  const detector = createEventDetector({ threshold: 0.2, cooldownMs: 1000, idFactory: () => 'fixed' });
  assert.equal(detector.observe(item('one', 1000, 20), source), null);
  const event = detector.observe(item('two', 1100, 60), source);
  assert.equal(event.id, 'evt_fixed');
  assert.equal(event.type, 'activity.change');
  assert.equal(event.from, 0.2);
  assert.equal(event.to, 0.6);
  assert.equal(event.magnitude, 0.4);
  assert.equal(detector.observe(item('three', 1500, 10), source), null);
  assert.equal(detector.observe(item('four', 2200, 10), source), null);
  assert.equal(detector.observe(item('five', 3300, 80), source).magnitude, 0.7);
});
