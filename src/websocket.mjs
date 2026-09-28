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
  let protocolError = null;

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
    else if (opcode === 0x8) protocolError = 'client requested close';
    else if (opcode === 0x9) messages.push(JSON.stringify({ type: 'ping' }));
  }

  return {
    messages,
    remainder: buffer.subarray(offset),
    protocolError
  };
}

