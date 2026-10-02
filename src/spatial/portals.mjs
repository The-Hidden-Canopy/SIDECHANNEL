export const PORTAL_KINDS = Object.freeze(['door', 'portal']);
export const MAX_PORTALS = 128;

function reason(id, message) {
  return { id, message };
}

function point(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function validatePortal(raw, { width = Number.POSITIVE_INFINITY, height = Number.POSITIVE_INFINITY } = {}) {
  const reasons = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [reason('portal.type', 'portal must be an object')] };
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 128)) {
    reasons.push(reason('portal.id', 'portal id must be a bounded non-empty string'));
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 80) {
    reasons.push(reason('portal.name', 'portal name must be 1 to 80 characters'));
  }
  const kind = raw.kind || 'portal';
  if (!PORTAL_KINDS.includes(kind)) reasons.push(reason('portal.kind', 'portal kind is unsupported'));
  if (!point(raw.from) || !point(raw.to)) reasons.push(reason('portal.points', 'portal requires finite from and to points'));
  for (const [label, value] of [['from', raw.from], ['to', raw.to]]) {
    if (point(value) && (value.x < 0 || value.y < 0 || value.x > width || value.y > height)) {
      reasons.push(reason('portal.bounds', label + ' point must remain inside the scene bounds'));
    }
  }
  if (point(raw.from) && point(raw.to) && raw.from.x === raw.to.x && raw.from.y === raw.to.y) {
    reasons.push(reason('portal.length', 'portal endpoints must not be identical'));
  }
  if (raw.regionIds !== undefined && (!Array.isArray(raw.regionIds) || raw.regionIds.length > 2 ||
      raw.regionIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128))) {
    reasons.push(reason('portal.regions', 'portal regionIds must contain at most two bounded ids'));
  }
  if (raw.color !== undefined && (typeof raw.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.color))) {
    reasons.push(reason('portal.color', 'portal color must be a six-digit hex color'));
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    portal: {
      ...(raw.id ? { id: raw.id } : {}),
      name: raw.name.trim(),
      kind,
      from: { x: raw.from.x, y: raw.from.y },
      to: { x: raw.to.x, y: raw.to.y },
      regionIds: Array.isArray(raw.regionIds) ? raw.regionIds.slice() : [],
      open: raw.open !== false,
      color: raw.color || '#ffd166'
    }
  };
}

export function validatePortals(portals, bounds = {}) {
  if (!Array.isArray(portals) || portals.length > MAX_PORTALS) {
    return { ok: false, reasons: [reason('portals.limit', 'scene portals must be an array of at most ' + MAX_PORTALS + ' items')] };
  }
  const validated = [];
  const ids = new Set();
  const reasons = [];
  portals.forEach((raw, index) => {
    const result = validatePortal(raw, bounds);
    if (!result.ok) {
      reasons.push(...result.reasons.map((item) => ({ ...item, index })));
      return;
    }
    if (result.portal.id && ids.has(result.portal.id)) {
      reasons.push(reason('portals.duplicate_id', 'portal id is duplicated: ' + result.portal.id));
      return;
    }
    if (result.portal.id) ids.add(result.portal.id);
    validated.push(result.portal);
  });
  return reasons.length ? { ok: false, reasons } : { ok: true, portals: validated };
}
