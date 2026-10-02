import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackground } from '../src/spatial/background.mjs';

const valid = {
  dataUrl: 'data:image/png;base64,AAECAw==',
  name: 'floorplan.png',
  x: 0.5,
  y: 0.25,
  width: 4,
  height: 3,
  rotationDeg: 2,
  opacity: 0.65
};

test('background accepts a bounded local image with scene-space placement', () => {
  const result = validateBackground(valid, { width: 5, height: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.background.mimeType, 'image/png');
  assert.equal(result.background.opacity, 0.65);
});

test('background fails closed for remote, oversized, and out-of-bounds inputs', () => {
  assert.equal(validateBackground({ ...valid, dataUrl: 'https://example.com/floorplan.png' }, { width: 5, height: 4 }).ok, false);
  assert.equal(validateBackground({ ...valid, x: 2, width: 4 }, { width: 5, height: 4 }).ok, false);
  assert.equal(validateBackground({ ...valid, opacity: 2 }, { width: 5, height: 4 }).ok, false);
});
