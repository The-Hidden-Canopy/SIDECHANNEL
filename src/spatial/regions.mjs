export const REGION_KINDS = Object.freeze(['room', 'zone']);
export const MAX_REGIONS = 128;
export const MAX_REGION_POINTS = 64;

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function reason(id, message) {
  return { id, message };
}

export function validateRegion(raw, { width = Number.POSITIVE_INFINITY, height = Number.POSITIVE_INFINITY } = {}) {
  const reasons = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [reason('region.type', 'region must be an object')] };
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 128)) {
    reasons.push(reason('region.id', 'region id must be a bounded non-empty string'));
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 80) {
    reasons.push(reason('region.name', 'region name must be 1 to 80 characters'));
  }
  const kind = raw.kind || 'zone';
  if (!REGION_KINDS.includes(kind)) reasons.push(reason('region.kind', 'region kind is unsupported'));
  if (!Array.isArray(raw.points) || raw.points.length < 3 || raw.points.length > MAX_REGION_POINTS) {
    reasons.push(reason('region.points', 'region requires 3 to ' + MAX_REGION_POINTS + ' points'));
  }
  if (Array.isArray(raw.points)) {
    raw.points.forEach((point, index) => {
      if (!finitePoint(point)) {
        reasons.push(reason('region.point', 'region point ' + index + ' must contain finite x and y'));
        return;
      }
      if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) {
        reasons.push(reason('region.bounds', 'region point ' + index + ' must remain inside the scene bounds'));
      }
    });
  }
  if (raw.color !== undefined && (typeof raw.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.color))) {
    reasons.push(reason('region.color', 'region color must be a six-digit hex color'));
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    region: {
      ...(raw.id ? { id: raw.id } : {}),
      name: raw.name.trim(),
      kind,
      points: raw.points.map((point) => ({ x: point.x, y: point.y })),
      color: raw.color || '#6ce4db'
    }
  };
}

export function validateRegions(regions, bounds = {}) {
  if (!Array.isArray(regions) || regions.length > MAX_REGIONS) {
    return { ok: false, reasons: [reason('regions.limit', 'scene regions must be an array of at most ' + MAX_REGIONS + ' items')] };
  }
  const validated = [];
  const ids = new Set();
  const reasons = [];
  regions.forEach((raw, index) => {
    const result = validateRegion(raw, bounds);
    if (!result.ok) {
      reasons.push(...result.reasons.map((item) => ({ ...item, index })));
      return;
    }
    if (result.region.id && ids.has(result.region.id)) {
      reasons.push(reason('regions.duplicate_id', 'region id is duplicated: ' + result.region.id));
      return;
    }
    if (result.region.id) ids.add(result.region.id);
    validated.push(result.region);
  });
  return reasons.length ? { ok: false, reasons } : { ok: true, regions: validated };
}
