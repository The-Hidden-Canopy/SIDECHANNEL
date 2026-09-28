import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeTextFrames, encodeTextFrame } from '../src/websocket.mjs';

function maskedClientFrame(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

test('parses a masked client frame even when delivered in chunks', () => {
  const frame = maskedClientFrame(JSON.stringify({ hello: 'sidechannel' }));
  const first = consumeTextFrames(frame.subarray(0, 3));
  assert.equal(first.messages.length, 0);
  const second = consumeTextFrames(Buffer.concat([first.remainder, frame.subarray(3)]));
  assert.deepEqual(JSON.parse(second.messages[0]), { hello: 'sidechannel' });
});

test('encodes a server text frame', () => {
  const frame = encodeTextFrame({ type: 'snapshot' });
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1] & 0x80, 0);
  const parsed = consumeTextFrames(frame);
  assert.deepEqual(JSON.parse(parsed.messages[0]), { type: 'snapshot' });
});

