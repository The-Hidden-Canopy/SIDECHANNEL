import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneView, SCENE_VIEW_FORMAT } from '../src/scene-view.mjs';

test('scene view bounds live detail and exposes independent source health projections', () => {
  const view = createSceneView({
    scene: {
      id: 'scene_test',
      sources: [
        { id: 'sim_source', name: 'Simulator', adapterType: 'simulator', channels: ['heat'], position: { x: 1, y: 1 } },
        { id: 'quarantined_source', name: 'Provider', adapterType: 'jsonl', channels: ['rf'], position: { x: 2, y: 2 }, providerManifest: { providerId: 'fixture.provider' } },
        { id: 'manual_source', name: 'Manual', adapterType: 'manual', channels: ['sound'], position: { x: 3, y: 3 } }
      ]
    },
    observations: [
      { id: 'old', sourceId: 'sim_source', timestampMs: 100, status: 'measured' },
      { id: 'fresh', sourceId: 'sim_source', timestampMs: 200, status: 'measured' },
      { id: 'stale', sourceId: 'manual_source', timestampMs: 300, status: 'stale' }
    ],
    events: [{ id: 'event_1' }, { id: 'event_2' }, { id: 'event_3' }],
    diagnostics: [{ id: 'diagnostic_1' }, { id: 'diagnostic_2' }],
    adapterRuntime: [
      { manifest: { providerId: 'builtin:simulator' }, state: 'STOPPED' },
      { manifest: { providerId: 'fixture.provider' }, state: 'QUARANTINED' }
    ],
    limits: { maxObservations: 2, maxEvents: 2, maxDiagnostics: 1 },
    nowMs: 500
  });

  assert.equal(view.format, SCENE_VIEW_FORMAT);
  assert.deepEqual(view.observations.map((observation) => observation.id), ['fresh', 'stale']);
  assert.deepEqual(view.events.map((event) => event.id), ['event_2', 'event_3']);
  assert.deepEqual(view.diagnostics.map((diagnostic) => diagnostic.id), ['diagnostic_2']);
  assert.deepEqual(view.sourceProjections.map((source) => source.health), ['disconnected', 'quarantined', 'stale']);
  assert.equal(view.sourceProjections[0].observationId, 'fresh');
  assert.equal(view.summary.sourceCount, 3);
  assert.equal(view.summary.observationCount, 3);
  assert.equal(view.limits.maxObservations, 2);
});
