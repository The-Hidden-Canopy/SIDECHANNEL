import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngressSequencer } from '../src/admission/sequencer.mjs';

test('ingress sequencer processes queued frames in order and bounds backlog', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sequencer = createIngressSequencer({
    maxQueue: 2,
    process: async (value) => {
      if (value === 'a') await gate;
      order.push(value);
      return { ok: true, value };
    },
    onDrop: (value, depth) => ({ ok: false, value, depth, reason: 'queue_full' })
  });

  const first = sequencer.enqueue('a');
  const second = sequencer.enqueue('b');
  const third = sequencer.enqueue('c');
  const dropped = sequencer.enqueue('d');
  assert.equal(sequencer.pending, 2);
  assert.deepEqual(await dropped, { ok: false, value: 'd', depth: 2, reason: 'queue_full' });
  release();
  assert.deepEqual(await Promise.all([first, second, third]), [
    { ok: true, value: 'a' },
    { ok: true, value: 'b' },
    { ok: true, value: 'c' }
  ]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});
