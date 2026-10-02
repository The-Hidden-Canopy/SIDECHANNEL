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

const MAX_EXTENT = 1000;
const MAX_SAMPLE_COUNT = 32;

function vector(value) {
  if (!isPlainObject(value) || !finite(value.x) || !finite(value.y)) return null;
  const length = Math.hypot(value.x, value.y);
  return length > 0 ? { x: value.x / length, y: value.y / length } : null;
}

function origin(value) {
  return point(value.origin || value.position || value.center);
}

function sampleCount(value, fallback = 4) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(MAX_SAMPLE_COUNT, Math.max(2, value));
}

function lineSamples(start, direction, length, count, supportType) {
  return Array.from({ length: count }, (_, index) => {
    const fraction = count === 1 ? 0 : index / (count - 1);
    return {
      position: {
        x: start.x + direction.x * length * fraction,
        y: start.y + direction.y * length * fraction
      },
      supportType
    };
  });
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
    if (!finite(value.radiusX) || !finite(value.radiusY) || value.radiusX < 0 || value.radiusY < 0 ||
        value.radiusX > MAX_EXTENT || value.radiusY > MAX_EXTENT || (value.radiusX === 0 && value.radiusY === 0)) {
      return { ok: false, reasons: [{ id: 'support.ellipse.radii', message: 'EllipseSupport radii must be bounded, non-negative, and not both zero' }] };
    }
  }
  if (['RaySupport', 'ConeSupport', 'FrustumSupport'].includes(value.type)) {
    if (!origin(value)) {
      return { ok: false, reasons: [{ id: 'support.' + value.type.slice(0, -7).toLowerCase() + '.origin', message: value.type + ' requires a finite origin' }] };
    }
    if (!vector(value.direction)) {
      return { ok: false, reasons: [{ id: 'support.' + value.type.slice(0, -7).toLowerCase() + '.direction', message: value.type + ' requires a non-zero finite direction' }] };
    }
  }
  if (value.type === 'RaySupport') {
    if (!finite(value.length) || value.length <= 0 || value.length > MAX_EXTENT) {
      return { ok: false, reasons: [{ id: 'support.ray.length', message: 'RaySupport length must be greater than zero and bounded' }] };
    }
  }
  if (value.type === 'ConeSupport') {
    if (!finite(value.length) || value.length <= 0 || value.length > MAX_EXTENT) {
      return { ok: false, reasons: [{ id: 'support.cone.length', message: 'ConeSupport length must be greater than zero and bounded' }] };
    }
    if (!finite(value.angleRad) || value.angleRad < 0 || value.angleRad > Math.PI / 2) {
      return { ok: false, reasons: [{ id: 'support.cone.angle', message: 'ConeSupport angleRad must be between zero and pi/2' }] };
    }
  }
  if (value.type === 'FrustumSupport') {
    if (!finite(value.near) || value.near < 0 || !finite(value.far) || value.far <= value.near || value.far > MAX_EXTENT) {
      return { ok: false, reasons: [{ id: 'support.frustum.depth', message: 'FrustumSupport near/far bounds must be ordered and bounded' }] };
    }
    if (!finite(value.nearWidth) || value.nearWidth < 0 || value.nearWidth > MAX_EXTENT ||
        !finite(value.farWidth) || value.farWidth < 0 || value.farWidth > MAX_EXTENT) {
      return { ok: false, reasons: [{ id: 'support.frustum.width', message: 'FrustumSupport widths must be bounded and non-negative' }] };
    }
  }
  if (value.type === 'VolumeSupport') {
    if (!point(value.center || value.position)) {
      return { ok: false, reasons: [{ id: 'support.volume.center', message: 'VolumeSupport requires a finite center' }] };
    }
    if (!finite(value.radiusX) || !finite(value.radiusY) || !finite(value.radiusZ) ||
        value.radiusX < 0 || value.radiusY < 0 || value.radiusZ < 0 ||
        value.radiusX > MAX_EXTENT || value.radiusY > MAX_EXTENT || value.radiusZ > MAX_EXTENT ||
        (value.radiusX === 0 && value.radiusY === 0 && value.radiusZ === 0)) {
      return { ok: false, reasons: [{ id: 'support.volume.radii', message: 'VolumeSupport radii must be bounded, non-negative, and not all zero' }] };
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
  if (!validateSpatialSupport(support).ok) return null;
  if (support.type === 'UnknownSupport') return null;
  if (support.position) return support.position;
  if (support.center) return support.center;
  if (support.origin) return support.origin;
  if (Array.isArray(support.points) && support.points.length > 0) {
    const total = support.points.reduce((sum, current) => ({ x: sum.x + current.x, y: sum.y + current.y }), { x: 0, y: 0 });
    return { x: total.x / support.points.length, y: total.y / support.points.length };
  }
  return observation?.position || source?.position || null;
}

export function supportSamples(observation, source) {
  const support = resolveSupport(observation, source);
  if (!validateSpatialSupport(support).ok) return [];
  if (support.type === 'UnknownSupport') return [];
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
  if (support.type === 'RaySupport' && origin(support) && vector(support.direction) && finite(support.length)) {
    return lineSamples(origin(support), vector(support.direction), support.length, sampleCount(support.sampleCount), support.type);
  }
  if (support.type === 'ConeSupport' && origin(support) && vector(support.direction) && finite(support.length) && finite(support.angleRad)) {
    const start = origin(support);
    const direction = vector(support.direction);
    const perpendicular = { x: -direction.y, y: direction.x };
    const rings = sampleCount(support.sampleCount);
    return Array.from({ length: rings }, (_, index) => {
      const fraction = index / (rings - 1);
      const distance = support.length * fraction;
      const halfWidth = distance * Math.tan(support.angleRad);
      const center = { x: start.x + direction.x * distance, y: start.y + direction.y * distance };
      return [
        { position: center, supportType: support.type },
        { position: { x: center.x + perpendicular.x * halfWidth, y: center.y + perpendicular.y * halfWidth }, supportType: support.type },
        { position: { x: center.x - perpendicular.x * halfWidth, y: center.y - perpendicular.y * halfWidth }, supportType: support.type }
      ];
    }).flat();
  }
  if (support.type === 'FrustumSupport' && origin(support) && vector(support.direction)) {
    const start = origin(support);
    const direction = vector(support.direction);
    const perpendicular = { x: -direction.y, y: direction.x };
    const rings = sampleCount(support.sampleCount);
    return Array.from({ length: rings }, (_, index) => {
      const fraction = index / (rings - 1);
      const distance = support.near + (support.far - support.near) * fraction;
      const width = support.nearWidth + (support.farWidth - support.nearWidth) * fraction;
      const center = { x: start.x + direction.x * distance, y: start.y + direction.y * distance };
      return [
        { position: center, supportType: support.type },
        { position: { x: center.x + perpendicular.x * width / 2, y: center.y + perpendicular.y * width / 2 }, supportType: support.type },
        { position: { x: center.x - perpendicular.x * width / 2, y: center.y - perpendicular.y * width / 2 }, supportType: support.type }
      ];
    }).flat();
  }
  if (support.type === 'VolumeSupport' && center && finite(support.radiusX) && finite(support.radiusY)) {
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
