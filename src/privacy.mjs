import { PRIVACY_CLASSES, privacyClassForSource } from './contracts.mjs';

const RAW_CONTENT_KEYS = Object.freeze([
  'rawAudio',
  'audioPayload',
  'networkPayload',
  'rawNetwork',
  'rawPayload'
]);

const PERSISTENT_IDENTITY_KEYS = Object.freeze([
  'deviceId',
  'deviceIdentity',
  'macAddress',
  'bluetoothAddress',
  'hardwareSerial',
  'serialNumber',
  'persistentDeviceId'
]);

function present(value) {
  return value !== undefined && value !== null && value !== false && value !== '';
}

function sensitiveFields(raw) {
  const fields = [];
  for (const key of [...RAW_CONTENT_KEYS, ...PERSISTENT_IDENTITY_KEYS]) {
    if (present(raw?.[key])) fields.push(key);
    if (present(raw?.metadata?.[key])) fields.push('metadata.' + key);
  }
  return fields;
}

export function validatePrivacyAdmission(raw, source) {
  const fields = sensitiveFields(raw);
  const rawFields = fields.filter((field) => RAW_CONTENT_KEYS.includes(field) || field.startsWith('metadata.'))
    .filter((field) => RAW_CONTENT_KEYS.includes(field.replace('metadata.', '')));
  const identityFields = fields.filter((field) => PERSISTENT_IDENTITY_KEYS.includes(field) || field.startsWith('metadata.'))
    .filter((field) => PERSISTENT_IDENTITY_KEYS.includes(field.replace('metadata.', '')));
  const privacyClass = raw?.privacyClass || privacyClassForSource(source);
  const rawPolicy = source?.providerManifest?.rawContentPolicy || 'none';
  const identityPolicy = source?.providerManifest?.sourceIdentityPolicy || source?.sourceIdentityPolicy || 'scene_local';
  const reasons = [];
  if (!PRIVACY_CLASSES.includes(privacyClass)) {
    reasons.push({ id: 'privacy.class', message: 'privacyClass is unsupported' });
  }
  if (rawFields.length && !(rawPolicy === 'explicit' && privacyClass === 'raw_retained_explicit')) {
    reasons.push({
      id: 'privacy.raw_content',
      message: 'raw content fields require an explicit provider policy and raw_retained_explicit privacy class'
    });
  }
  if (identityFields.length && !(identityPolicy === 'explicit' && privacyClass === 'raw_retained_explicit')) {
    reasons.push({
      id: 'privacy.persistent_identity',
      message: 'persistent device identity fields are prohibited without explicit opt-in'
    });
  }
  return {
    ok: reasons.length === 0,
    reasons,
    privacyClass,
    omittedFields: fields
  };
}

export function sanitizeObservationMetadata(metadata, omittedFields = []) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const sensitive = new Set(omittedFields.map((field) => field.replace('metadata.', '')));
  const safe = Object.fromEntries(Object.entries(metadata).filter(([key]) => !sensitive.has(key)));
  if (omittedFields.length) safe.privacyOmittedFields = omittedFields.slice();
  return safe;
}
