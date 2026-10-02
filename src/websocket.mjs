export function encodeControlFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.from(payload);
  if ((opcode & 0x08) === 0 || body.length > 125) {
    throw new Error('control frame opcode or payload is invalid');
  }
  return Buffer.concat([Buffer.from([0x80 | (opcode & 0x0f), body.length]), body]);
}

export function encodePongFrame(payload = Buffer.alloc(0)) {
  return encodeControlFrame(0x0a, payload);
}

export function encodeCloseFrame(code = 1000, reason = '') {
  const reasonBytes = Buffer.from(String(reason), 'utf8').subarray(0, 123);
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return encodeControlFrame(0x08, payload);
}

export function encodeTextFrame(value) {
  const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

export function consumeTextFrames(buffer, maxPayloadLength = 2_000_000) {
  let offset = 0;
  const messages = [];
  const controlFrames = [];
  let protocolError = null;
  let closeRequested = false;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const final = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (!final) {
      protocolError = 'fragmented frames are not supported';
      break;
    }
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const longLength = buffer.readBigUInt64BE(offset + 2);
      if (longLength > BigInt(maxPayloadLength)) {
        protocolError = 'frame payload exceeds maximum size';
        break;
      }
      length = Number(longLength);
      headerLength = 10;
    }
    if (length > maxPayloadLength) {
      protocolError = 'frame payload exceeds maximum size';
      break;
    }
    if ((opcode & 0x08) !== 0 && (length > 125 || !final)) {
      protocolError = 'control frame is fragmented or oversized';
      break;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > buffer.length) break;

    let payloadStart = offset + headerLength;
    const mask = masked ? buffer.subarray(payloadStart, payloadStart + 4) : null;
    if (masked) payloadStart += 4;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));

    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    offset += frameLength;
    if (opcode === 0x1) messages.push(payload.toString('utf8'));
    else if (opcode === 0x8) {
      closeRequested = true;
      controlFrames.push({ opcode, payload });
    }
    else if (opcode === 0x9) controlFrames.push({ opcode: 0x0a, payload });
    else if (opcode === 0x0a) controlFrames.push({ opcode, payload });
    else if (opcode !== 0x0) protocolError = 'unsupported websocket opcode';
  }

  return {
    messages,
    controlFrames,
    remainder: buffer.subarray(offset),
    protocolError,
    closeRequested
  };
}
