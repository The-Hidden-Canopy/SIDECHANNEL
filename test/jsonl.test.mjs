import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { consumeJsonLines } from '../src/adapters/jsonl.mjs';

test('consumes valid JSON lines and reports malformed lines without stopping', async () => {
  const values = [];
  const errors = [];
  const result = await consumeJsonLines(
    Readable.from(['{"value":1}\n', 'not-json\n', '{"value":2}\n']),
    (value) => values.push(value),
    { onError: (error) => errors.push(error) }
  );
  assert.deepEqual(values, [{ value: 1 }, { value: 2 }]);
  assert.equal(errors.length, 1);
  assert.equal(result.errors.length, 1);
});
