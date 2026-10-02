import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.mjs';

const scene = {
  id: 'scene_test',
  name: 'Test room',
  width: 3,
  height: 2,
  unit: 'm',
  sources: [],
  placements: []
};

function observation(id, timestampMs = 1000) {
  return {
    schemaVersion: '0.1',
    id,
    sourceId: 'source_test',
    channel: 'heat',
    timestampMs,
    value: 22,
    unit: 'C',
    status: 'measured',
    quality: { score: 1, state: 'good', reasons: [] }
  };
}

test('SQLite store persists sessions, observations, events, and deletion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-sqlite-'));
  const path = join(directory, 'sidechannel.sqlite');
  const store = new SqliteStore(path);
  try {
    await store.init(scene);
    const session = store.createSession(scene.id, {
      scene: { ...scene, name: 'Frozen test room', sources: [{ id: 'source_test', calibrationState: 'calibrated' }] },
      sources: [{ id: 'source_test', calibrationState: 'calibrated' }],
      transformGraph: { revision: 1, placements: [] }
    });
    store.appendObservation(session.id, observation('observation_1'));
    store.appendPose(session.id, {
      schema: 'sidechannel.pose/1',
      sampleId: 'pose_test_1',
      sourceId: 'source_test',
      timestampMs: 1000,
      frameId: 'scene',
      position: { x: 1, y: 1 }
    });
    store.appendEvent(session.id, { id: 'event_1', type: 'activity.change', startMs: 1000, endMs: null });
    const finished = store.finishSession(session.id);
    assert.equal(finished.observations.length, 1);
    assert.equal(finished.poses.length, 1);
    assert.equal(finished.events.length, 1);
    assert.equal(finished.snapshotComplete, true);
    assert.equal(finished.state, 'completed');
    assert.equal(finished.sceneSnapshot.name, 'Frozen test room');
    assert.equal(store.listSessions()[0].observationCount, 1);
    store.close();

    const reopened = new SqliteStore(path);
    await reopened.init(scene);
    assert.equal(reopened.getSession(session.id).observations[0].id, 'observation_1');
    assert.equal(reopened.getSession(session.id).poses[0].sampleId, 'pose_test_1');
    assert.equal(reopened.getSession(session.id).events[0].type, 'activity.change');
    assert.equal(reopened.getSession(session.id).sceneSnapshot.name, 'Frozen test room');
    assert.equal(reopened.deleteSession(session.id), true);
    assert.equal(reopened.getSession(session.id), undefined);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('session snapshots remain historical after the live scene changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-snapshot-'));
  const path = join(directory, 'sidechannel.sqlite');
  const store = new SqliteStore(path);
  try {
    await store.init(scene);
    store.upsertScene({ ...scene, name: 'Before move', sources: [{ id: 'source_test', position: { x: 1, y: 1 } }] });
    const session = store.createSession(scene.id);
    store.upsertScene({ ...scene, name: 'After move', sources: [{ id: 'source_test', position: { x: 2, y: 1 } }] });
    const historical = store.getSession(session.id);
    assert.equal(historical.sceneSnapshot.name, 'Before move');
    assert.deepEqual(historical.sceneSnapshot.sources[0].position, { x: 1, y: 1 });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('session observations replay in admitted order rather than timestamp order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-order-'));
  const path = join(directory, 'sidechannel.sqlite');
  const store = new SqliteStore(path);
  try {
    await store.init(scene);
    const session = store.createSession(scene.id);
    store.appendObservation(session.id, { ...observation('observation_first', 2000), sequence: 1 });
    store.appendObservation(session.id, { ...observation('observation_second', 1000), sequence: 2 });
    const restored = store.getSession(session.id);
    assert.deepEqual(restored.observations.map((item) => item.id), [
      'observation_first',
      'observation_second'
    ]);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('open sessions become interrupted after a store restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-interrupted-'));
  const path = join(directory, 'sidechannel.sqlite');
  try {
    const first = new SqliteStore(path);
    await first.init(scene);
    const session = first.createSession(scene.id);
    first.close();
    const reopened = new SqliteStore(path);
    await reopened.init(scene);
    assert.equal(reopened.getSession(session.id).state, 'interrupted');
    assert.equal(reopened.getSession(session.id).interruptionReason, 'process_restart');
    assert.equal(reopened.finishSession(session.id), null);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('runtime adapter failures are retained in the authoritative journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-runtime-event-'));
  const path = join(directory, 'sidechannel.sqlite');
  const store = new SqliteStore(path);
  try {
    await store.init(scene);
    const session = store.createSession(scene.id);
    const entry = store.appendRuntimeEvent(session.id, 'AdapterQuarantined', {
      providerId: 'fixture.adapter',
      reason: 'malformed frame',
      failureCount: 3
    }, 1234);
    assert.equal(entry.type, 'AdapterQuarantined');
    assert.equal(store.getSession(session.id).journal.at(-1).payload.failureCount, 3);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('imported observations are explicitly labelled and retain package provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-imported-evidence-'));
  const path = join(directory, 'sidechannel.sqlite');
  const store = new SqliteStore(path);
  try {
    await store.init(scene);
    const imported = store.importPackage({
      sessionId: 'sess_external',
      sceneSnapshot: { ...scene, id: 'scene_external' },
      sourceRegistrySnapshot: [],
      observations: [{
        id: 'external_observation',
        sourceId: 'external_source',
        channel: 'heat',
        timestampMs: 1000,
        value: 22,
        evidenceState: 'measured',
        metadata: { source: 'fixture' }
      }],
      events: []
    });
    const observation = store.getSession(imported.id).observations[0];
    assert.equal(observation.evidenceState, 'imported');
    assert.equal(observation.metadata.importedFromSessionId, 'sess_external');
    assert.equal(observation.provenance.at(-1).relation, 'imported_from');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite store migrates the existing JSON state format once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-migrate-'));
  const dbPath = join(directory, 'sidechannel.sqlite');
  const legacyPath = join(directory, 'sidechannel.json');
  const legacySession = {
    id: 'sess_legacy',
    sceneId: scene.id,
    startedAtMs: 10,
    endedAtMs: 20,
    observations: [observation('legacy_observation', 12)],
    events: []
  };
  try {
    await writeFile(legacyPath, JSON.stringify({ scenes: [scene], sessions: [legacySession] }));
    const store = new SqliteStore(dbPath, { legacyJsonPath: legacyPath });
    await store.init(scene);
    assert.equal(store.getScene(scene.id).name, 'Test room');
    assert.equal(store.getSession('sess_legacy').observations.length, 1);
    store.close();
    assert.equal(JSON.parse(await readFile(legacyPath, 'utf8')).sessions.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
