import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeTextFrames, encodeCloseFrame, encodePongFrame, encodeTextFrame } from '../src/websocket.mjs';

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

function maskedControlFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.from(payload);
  const mask = Buffer.from([5, 6, 7, 8]);
  const header = body.length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | body.length])
    : Buffer.from([0x80 | opcode, 0x80 | 126, body.length >> 8, body.length & 0xff]);
  const masked = Buffer.from(body);
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4];
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

test('turns masked client ping into a bounded pong control frame', () => {
  const parsed = consumeTextFrames(maskedControlFrame(0x9, Buffer.from('probe')));
  assert.equal(parsed.protocolError, null);
  assert.equal(parsed.closeRequested, false);
  assert.equal(parsed.controlFrames.length, 1);
  assert.equal(parsed.controlFrames[0].opcode, 0x0a);
  assert.equal(parsed.controlFrames[0].payload.toString(), 'probe');
  const pong = encodePongFrame(Buffer.from('probe'));
  assert.equal(pong[0], 0x8a);
  assert.equal(pong[1], 5);
});

test('acknowledges a masked client close without treating it as a protocol error', () => {
  const closePayload = Buffer.from([0x03, 0xe8]);
  const parsed = consumeTextFrames(maskedControlFrame(0x8, closePayload));
  assert.equal(parsed.protocolError, null);
  assert.equal(parsed.closeRequested, true);
  assert.equal(parsed.controlFrames[0].opcode, 0x8);
  assert.deepEqual(parsed.controlFrames[0].payload, closePayload);
  const close = encodeCloseFrame(1000);
  assert.equal(close[0], 0x88);
  assert.equal(close[1], 2);
});

test('rejects oversized control frames before exposing them', () => {
  const frame = maskedControlFrame(0x9, Buffer.alloc(126));
  const parsed = consumeTextFrames(frame);
  assert.equal(parsed.protocolError, 'control frame is fragmented or oversized');
  assert.equal(parsed.controlFrames.length, 0);
});
