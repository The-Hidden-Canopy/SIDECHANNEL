import { isPlainObject } from '../contracts.mjs';

export const SUPPORT_TYPES = Object.freeze([
  'PointSupport',
  'RegionSupport',
  'PathSupport',
  'RaySupport',
  'ConeSupport',
  'FrustumSupport',
  'EllipseSupport',
  'VolumeSupport',
  'UnknownSupport'
]);

export function validateSpatialSupport(value) {
  if (value === undefined) return { ok: true, support: undefined };
  if (!isPlainObject(value) || !SUPPORT_TYPES.includes(value.type)) {
    return { ok: false, reasons: [{ id: 'support.type', message: 'support type is unsupported' }] };
  }
  if (value.frameId !== undefined && (typeof value.frameId !== 'string' || value.frameId.length === 0)) {
    return { ok: false, reasons: [{ id: 'support.frameId', message: 'support frameId must be a non-empty string' }] };
  }
  if (value.position !== undefined &&
      (!isPlainObject(value.position) || !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y))) {
    return { ok: false, reasons: [{ id: 'support.position', message: 'support position requires finite x and y' }] };
  }
  return { ok: true, support: { ...value } };
}

export function resolveSupport(observation, source) {
  if (observation?.support) return observation.support;
  if (source?.support) return source.support;
  const position = observation?.position || source?.position;
  return position ? { type: 'PointSupport', frameId: 'scene', position: { ...position } } : { type: 'UnknownSupport' };
}

export function supportPosition(observation, source) {
  const support = resolveSupport(observation, source);
  if (support.position) return support.position;
  if (support.center) return support.center;
  return observation?.position || source?.position || null;
}
