import test from 'node:test';
import assert from 'node:assert/strict';
import { TransformGraph } from '../src/spatial/transform-graph.mjs';

test('transform graph versions edges and rejects direct cycles', () => {
  const graph = new TransformGraph({ clock: () => 1000 });
  const edge = graph.publish({
    transformId: 't_scene_sensor',
    fromFrame: 'sensor',
    toFrame: 'scene',
    translation: { x: 1, y: 2, z: 0 },
    uncertainty: { radius: 0.2 }
  });
  assert.equal(edge.revision, 1);
  assert.equal(graph.resolve('sensor', 'scene').edges[0].transformId, 't_scene_sensor');
  assert.throws(() => graph.publish({ fromFrame: 'scene', toFrame: 'sensor' }), /cycle/);
  assert.equal(graph.snapshot().revision, 1);
  assert.throws(() => graph.publish({ fromFrame: 'scene', toFrame: 'scene' }), /cycle/);
});
