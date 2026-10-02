import { isPlainObject } from '../contracts.mjs';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function point(value) {
  return isPlainObject(value) && finite(value.x) && finite(value.y) &&
    (value.z === undefined || finite(value.z))
    ? { x: value.x, y: value.y, ...(value.z === undefined ? {} : { z: value.z }) }
    : null;
}

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
  if (value.center !== undefined && !point(value.center)) {
    return { ok: false, reasons: [{ id: 'support.center', message: 'support center requires finite x and y' }] };
  }
  if (value.type === 'RegionSupport') {
    if (!point(value.center || value.position)) {
      return { ok: false, reasons: [{ id: 'support.region.center', message: 'RegionSupport requires a finite center' }] };
    }
    if (value.radius !== undefined && (!finite(value.radius) || value.radius < 0)) {
      return { ok: false, reasons: [{ id: 'support.region.radius', message: 'RegionSupport radius must be non-negative and finite' }] };
    }
  }
  if (value.type === 'PathSupport') {
    if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 256 || !value.points.every(point)) {
      return { ok: false, reasons: [{ id: 'support.path.points', message: 'PathSupport requires two to 256 finite points' }] };
    }
  }
  if (value.type === 'EllipseSupport') {
    if (!point(value.center || value.position)) {
      return { ok: false, reasons: [{ id: 'support.ellipse.center', message: 'EllipseSupport requires a finite center' }] };
    }
    if (!finite(value.radiusX) || !finite(value.radiusY) || value.radiusX < 0 || value.radiusY < 0) {
      return { ok: false, reasons: [{ id: 'support.ellipse.radii', message: 'EllipseSupport radii must be non-negative and finite' }] };
    }
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
  if (Array.isArray(support.points) && support.points.length > 0) {
    const total = support.points.reduce((sum, current) => ({ x: sum.x + current.x, y: sum.y + current.y }), { x: 0, y: 0 });
    return { x: total.x / support.points.length, y: total.y / support.points.length };
  }
  return observation?.position || source?.position || null;
}

export function supportSamples(observation, source) {
  const support = resolveSupport(observation, source);
  const center = point(support.center || support.position || observation?.position || source?.position);
  if (support.type === 'RegionSupport' && center) {
    const radius = finite(support.radius) ? support.radius : 0;
    if (radius === 0) return [{ position: center, supportType: support.type }];
    return [
      { position: center, supportType: support.type },
      { position: { x: center.x + radius, y: center.y }, supportType: support.type },
      { position: { x: center.x - radius, y: center.y }, supportType: support.type },
      { position: { x: center.x, y: center.y + radius }, supportType: support.type },
      { position: { x: center.x, y: center.y - radius }, supportType: support.type }
    ];
  }
  if (support.type === 'PathSupport' && Array.isArray(support.points)) {
    return support.points.map((position) => ({ position: point(position), supportType: support.type }));
  }
  if (support.type === 'EllipseSupport' && center) {
    const points = [{ x: center.x, y: center.y }];
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      points.push({
        x: center.x + support.radiusX * Math.cos(angle),
        y: center.y + support.radiusY * Math.sin(angle)
      });
    }
    return points.map((position) => ({ position, supportType: support.type }));
  }
  return center ? [{ position: center, supportType: support.type }] : [];
}
