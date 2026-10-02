export const BACKGROUND_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_BACKGROUND_DATA_URL_LENGTH = 1_800_000;

function reason(id, message) {
  return { id, message };
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateBackground(raw, { width = Number.POSITIVE_INFINITY, height = Number.POSITIVE_INFINITY } = {}) {
  if (raw === undefined || raw === null) return { ok: true, background: null };
  const reasons = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [reason('background.type', 'background must be an object or null')] };
  }
  if (typeof raw.dataUrl !== 'string' || raw.dataUrl.length === 0 || raw.dataUrl.length > MAX_BACKGROUND_DATA_URL_LENGTH) {
    reasons.push(reason('background.data_url', 'background dataUrl must be a non-empty bounded data URL'));
  }
  const dataUrlMatch = typeof raw.dataUrl === 'string'
    ? raw.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/)
    : null;
  if (!dataUrlMatch) reasons.push(reason('background.format', 'background must be a base64 PNG, JPEG, or WebP data URL'));
  const mimeType = raw.mimeType || dataUrlMatch?.[1];
  if (!BACKGROUND_MIME_TYPES.includes(mimeType)) reasons.push(reason('background.mime_type', 'background mimeType is unsupported'));
  if (dataUrlMatch && dataUrlMatch[1] !== mimeType) reasons.push(reason('background.mime_mismatch', 'background mimeType must match the data URL'));
  if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 120)) {
    reasons.push(reason('background.name', 'background name must be 1 to 120 characters when provided'));
  }
  for (const [field, value] of [['x', raw.x], ['y', raw.y], ['width', raw.width], ['height', raw.height], ['rotationDeg', raw.rotationDeg], ['opacity', raw.opacity]]) {
    if (!finite(value)) reasons.push(reason('background.' + field, 'background ' + field + ' must be finite'));
  }
  if (finite(raw.width) && raw.width <= 0) reasons.push(reason('background.width', 'background width must be positive'));
  if (finite(raw.height) && raw.height <= 0) reasons.push(reason('background.height', 'background height must be positive'));
  if (finite(raw.x) && finite(raw.width) && (raw.x < 0 || raw.x + raw.width > width)) {
    reasons.push(reason('background.bounds', 'background x and width must remain inside the scene bounds'));
  }
  if (finite(raw.y) && finite(raw.height) && (raw.y < 0 || raw.y + raw.height > height)) {
    reasons.push(reason('background.bounds', 'background y and height must remain inside the scene bounds'));
  }
  if (finite(raw.rotationDeg) && (raw.rotationDeg < -3600 || raw.rotationDeg > 3600)) {
    reasons.push(reason('background.rotation', 'background rotationDeg must remain within +/-3600 degrees'));
  }
  if (finite(raw.opacity) && (raw.opacity < 0 || raw.opacity > 1)) {
    reasons.push(reason('background.opacity', 'background opacity must be between 0 and 1'));
  }
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    background: {
      dataUrl: raw.dataUrl,
      mimeType,
      ...(raw.name ? { name: raw.name.trim() } : {}),
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
      rotationDeg: raw.rotationDeg,
      opacity: raw.opacity
    }
  };
}
