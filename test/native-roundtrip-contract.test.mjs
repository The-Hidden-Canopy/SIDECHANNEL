import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultScene } from '../src/simulator.mjs';
import { SqliteStore } from '../src/sqlite-store.mjs';

test('native package import boundary relabels evidence and journals acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-roundtrip-contract-'));
  const store = new SqliteStore(join(directory, 'roundtrip.sqlite'));
  try {
    await store.init(createDefaultScene());
    const imported = store.importPackage({
      format: 'sidechannel-session',
      formatVersion: '0.2',
      sessionId: 'session_native_fixture',
      sceneSnapshot: createDefaultScene(),
      sourceRegistrySnapshot: createDefaultScene().sources,
      calibrationRegistrySnapshot: [],
      transformGraphSnapshot: { schemaVersion: '0.1', placements: [] },
      observations: [{
        id: 'native_fixture_observation',
        sourceId: 'sim_heat',
        channel: 'heat',
        timestampMs: 1000,
        value: 22,
        evidenceState: 'simulated',
        metadata: {}
      }],
      poses: [],
      events: []
    });
    const retained = store.getSession(imported.id);
    assert.equal(retained.observations[0].evidenceState, 'imported');
    assert.equal(retained.observations[0].metadata.importedFromSessionId, 'session_native_fixture');
    assert.equal(retained.observations[0].provenance.at(-1).relation, 'imported_from');
    assert.equal(retained.journal.at(-1).type, 'ImportAccepted');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
