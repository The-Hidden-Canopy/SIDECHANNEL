import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecomputedArtifacts, createHistoricalReplay, recomputeSession, verifyDeterminism } from '../src/replay.mjs';

function session(name = 'room') {
  const source = {
    id: 'source_heat',
    name: 'Heat',
    channels: ['heat'],
    range: [0, 100],
    position: { x: 1, y: 1 }
  };
  return {
    id: 'sess_' + name,
    snapshotDigest: 'snapshot_' + name,
    sceneSnapshot: { id: 'scene_' + name, width: 2, height: 2, sources: [source], placements: [] },
    sourceRegistrySnapshot: [source],
    calibrationRegistrySnapshot: [],
    transformGraphSnapshot: { revision: 0, edges: [] },
    observations: [{
      id: 'observation_' + name,
      sequence: 1,
      sourceId: source.id,
      channel: 'heat',
      timestampMs: 1000,
      value: 50,
      status: 'measured',
      quality: { score: 1 }
    }],
    events: [],
    journal: []
  };
}

test('historical replay is self-contained and labelled recorded', () => {
  const replay = createHistoricalReplay(session());
  assert.equal(replay.mode, 'historical');
  assert.equal(replay.artifactState, 'recorded');
  assert.equal(replay.scene.id, 'scene_room');
  assert.equal(replay.observations[0].id, 'observation_room');
  assert.equal(typeof replay.outputDigest, 'string');
});

test('recompute and determinism reports are explicitly derived', () => {
  const source = session();
  const first = recomputeSession(source, { gridSize: 4 });
  const second = recomputeSession(source, { gridSize: 4 });
  assert.equal(first.mode, 'recompute');
  assert.equal(first.artifactState, 'recomputed');
  assert.equal(first.outputDigest, second.outputDigest);
  assert.equal(verifyDeterminism(source, { gridSize: 4 }).ok, true);
});

test('comparison preserves source sessions and reports derived differences', () => {
  const left = recomputeSession(session('left'), { gridSize: 4 });
  const rightSession = session('right');
  rightSession.observations[0].value = 80;
  const right = recomputeSession(rightSession, { gridSize: 4 });
  const comparison = compareRecomputedArtifacts(left, right);
  assert.deepEqual(comparison.sourceSessionIds, ['sess_left', 'sess_right']);
  assert.equal(comparison.truthMode, 'difference');
  assert.ok(comparison.metrics.changedCellCount > 0);
  assert.equal(typeof comparison.outputDigest, 'string');
});

test('temporal comparison keeps one session and explicit pinned times', () => {
  const source = session('temporal');
  source.observations.push({
    ...source.observations[0],
    id: 'observation_temporal_2',
    sequence: 2,
    timestampMs: 2000,
    value: 90
  });
  const first = recomputeSession(source, { gridSize: 4, atTimeMs: 1000 });
  const second = recomputeSession(source, { gridSize: 4, atTimeMs: 2000 });
  const comparison = compareRecomputedArtifacts(first, second, { comparisonKind: 'within-session-temporal' });
  assert.equal(comparison.comparisonKind, 'within-session-temporal');
  assert.deepEqual(comparison.sourceSessionIds, ['sess_temporal', 'sess_temporal']);
  assert.deepEqual(comparison.sourceTimesMs, [1000, 2000]);
  assert.ok(comparison.metrics.changedCellCount > 0);
});

test('replay refuses a session without historical snapshots', () => {
  assert.throws(
    () => createHistoricalReplay({ id: 'sess_incomplete', observations: [], events: [] }),
    (error) => error.code === 'INCOMPLETE_SNAPSHOT'
  );
});
