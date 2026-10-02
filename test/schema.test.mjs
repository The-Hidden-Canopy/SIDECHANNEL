import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_SCHEMA, SCHEMA_SET, SCHEMA_SET_DIGEST } from '../src/schema.mjs';

test('schema set names canonical cross-runtime contracts and has a stable digest', () => {
  assert.equal(OBSERVATION_SCHEMA, 'sidechannel.observation/2');
  assert.equal(SCHEMA_SET.observation, OBSERVATION_SCHEMA);
  assert.equal(SCHEMA_SET_DIGEST.length, 64);
  assert.match(SCHEMA_SET_DIGEST, /^[0-9a-f]+$/);
});
