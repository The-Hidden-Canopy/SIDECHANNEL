import { isPlainObject } from '../contracts.mjs';

export const ADAPTER_FRAME_TYPES = Object.freeze([
  'hello',
  'configure',
  'permission_request',
  'ready',
  'observation',
  'health',
  'diagnostic',
  'stop',
  'stopped',
  'error'
]);

export function validateAdapterFrame(raw, { maxBytes = 64_000 } = {}) {
  const reasons = [];
  if (!isPlainObject(raw)) return { ok: false, reasons: [{ id: 'frame.object', message: 'adapter frame must be an object' }] };
  if (raw.protocolVersion !== 'sidechannel.adapter/1') {
    reasons.push({ id: 'frame.protocolVersion', message: 'unsupported adapter protocol version' });
  }
  if (!ADAPTER_FRAME_TYPES.includes(raw.type)) {
    reasons.push({ id: 'frame.type', message: 'adapter frame type is unsupported' });
  }
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes > maxBytes) reasons.push({ id: 'frame.bytes', message: 'adapter frame exceeds declared byte limit' });
  if (raw.payload !== undefined && !isPlainObject(raw.payload)) {
    reasons.push({ id: 'frame.payload', message: 'adapter frame payload must be an object' });
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, bytes, frame: { ...raw } };
}
