import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, listAdapters } from '../src/adapters/registry.mjs';

test('adapter registry exposes safe descriptors for built-in source paths', () => {
  const adapters = listAdapters();
  assert.deepEqual(adapters.map((adapter) => adapter.type), ['simulator', 'manual', 'jsonl', 'websocket', 'subprocess']);
  assert.equal(getAdapter('manual').capabilities[0], 'manual_observation');
  assert.equal(getAdapter('unknown'), null);

  adapters[0].capabilities.push('mutated');
  assert.equal(getAdapter('simulator').capabilities.includes('mutated'), false);
});
