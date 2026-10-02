import test from 'node:test';
import assert from 'node:assert/strict';
import { HashChainJournal } from '../src/journal.mjs';

test('hash-chain journal verifies its tail and detects tampering', () => {
  const journal = new HashChainJournal({ sessionId: 'session_1', clock: () => 1000, idFactory: () => 'fixed' });
  journal.append('SessionOpened', { scene: 'scene_1' });
  journal.append('ObservationAdmitted', { observationId: 'obs_1' });
  assert.equal(journal.verify().ok, true);
  const tampered = journal.events.map((event) => ({ ...event, payload: { ...event.payload } }));
  tampered[1].payload.observationId = 'obs_changed';
  assert.equal(journal.verify(tampered).ok, false);
});
