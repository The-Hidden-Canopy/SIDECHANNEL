import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePortal, validatePortals } from '../src/spatial/portals.mjs';

test('portals accept bounded door segments with room references', () => {
  const result = validatePortal({
    name: 'Main door',
    kind: 'door',
    from: { x: 1, y: 0 },
    to: { x: 2, y: 0 },
    regionIds: ['room_a', 'room_b']
  }, { width: 5, height: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.portal.open, true);
  assert.deepEqual(result.portal.regionIds, ['room_a', 'room_b']);
});

test('portals fail closed for degenerate or out-of-bounds segments', () => {
  const result = validatePortals([
    { id: 'same', name: 'Same', from: { x: 1, y: 1 }, to: { x: 1, y: 1 } },
    { id: 'outside', name: 'Outside', from: { x: -1, y: 1 }, to: { x: 2, y: 1 } }
  ], { width: 5, height: 4 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.id === 'portal.length'));
  assert.ok(result.reasons.some((reason) => reason.id === 'portal.bounds'));
});
