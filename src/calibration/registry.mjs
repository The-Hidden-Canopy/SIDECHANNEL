import { createHash, randomUUID } from 'node:crypto';

function encode(value) {
  return JSON.stringify(value ?? null);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function compatibilityReason(id, message) {
  return { id, message };
}

export function assessCalibrationCompatibility(calibration, {
  providerDigest = null,
  sourceProfileDigest = null,
  transformRevision = null,
  nowMs = Date.now()
} = {}) {
  const reasons = [];
  if (!calibration) {
    reasons.push(compatibilityReason('calibration.missing', 'calibration record is missing'));
    return {
      ok: false,
      status: 'missing',
      calibrationId: null,
      providerDigest,
      sourceProfileDigest,
      transformRevision,
      reasons
    };
  }

  if (calibration.validityState !== 'valid') {
    reasons.push(compatibilityReason('calibration.invalid', 'calibration record is not valid'));
  }
  if (calibration.expiresAtMs !== null && calibration.expiresAtMs !== undefined) {
    if (!finite(calibration.expiresAtMs) || calibration.expiresAtMs <= nowMs) {
      reasons.push(compatibilityReason('calibration.expired', 'calibration record is expired'));
    }
  }

  if (calibration.providerDigest) {
    if (!providerDigest) {
      reasons.push(compatibilityReason(
        'calibration.provider_digest_missing',
        'current provider digest is required for this calibration'
      ));
    } else if (calibration.providerDigest !== providerDigest) {
      reasons.push(compatibilityReason(
        'calibration.provider_digest_mismatch',
        'calibration was created for a different provider digest'
      ));
    }
  } else {
    reasons.push(compatibilityReason(
      'calibration.provider_digest_unbound',
      'calibration has no provider digest and cannot be safely reused'
    ));
  }

  if (calibration.sourceProfileDigest) {
    if (!sourceProfileDigest) {
      reasons.push(compatibilityReason(
        'calibration.source_profile_digest_missing',
        'current source profile digest is required for this calibration'
      ));
    } else if (calibration.sourceProfileDigest !== sourceProfileDigest) {
      reasons.push(compatibilityReason(
        'calibration.source_profile_digest_mismatch',
        'calibration was created for a different source profile digest'
      ));
    }
  } else {
    reasons.push(compatibilityReason(
      'calibration.source_profile_digest_unbound',
      'calibration has no source profile digest and cannot be safely reused'
    ));
  }

  if (calibration.transformRevision !== null && calibration.transformRevision !== undefined) {
    if (!Number.isInteger(transformRevision) || transformRevision < 0) {
      reasons.push(compatibilityReason(
        'calibration.transform_revision_missing',
        'current transform revision is required for this calibration'
      ));
    } else if (calibration.transformRevision !== transformRevision) {
      reasons.push(compatibilityReason(
        'calibration.transform_revision_mismatch',
        'calibration was created for a different transform revision'
      ));
    }
  }

  const status = reasons.length === 0
    ? 'compatible'
    : reasons.some((reason) => reason.id.endsWith('_unbound'))
      ? 'unbound'
      : 'incompatible';
  return {
    ok: status === 'compatible',
    status,
    calibrationId: calibration.calibrationId || null,
    providerDigest,
    sourceProfileDigest,
    transformRevision,
    reasons
  };
}

export class CalibrationRegistry {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.records = new Map();
    this.revision = 0;
  }

  publish(input = {}) {
    if (typeof input.sourceId !== 'string' || input.sourceId.length === 0) {
      throw new Error('sourceId is required');
    }
    if (typeof input.algorithmId !== 'string' || input.algorithmId.length === 0) {
      throw new Error('algorithmId is required');
    }
    if (input.baselineSummary !== undefined && typeof input.baselineSummary !== 'object') {
      throw new Error('baselineSummary must be an object');
    }
    if (input.expiresAtMs !== undefined && (!finite(input.expiresAtMs) || input.expiresAtMs <= this.clock())) {
      throw new Error('expiresAtMs must be in the future');
    }
    if (input.transformRevision !== undefined &&
        (!Number.isInteger(input.transformRevision) || input.transformRevision < 0)) {
      throw new Error('transformRevision must be a non-negative integer');
    }
    const record = {
      schemaVersion: '0.1',
      calibrationId: input.calibrationId || 'cal_' + randomUUID(),
      revision: ++this.revision,
      sourceId: input.sourceId,
      sourceProfileDigest: input.sourceProfileDigest || null,
      providerDigest: input.providerDigest || null,
      transformRevision: input.transformRevision === undefined ? null : input.transformRevision,
      algorithmId: input.algorithmId,
      algorithmVersion: input.algorithmVersion || '0.1.0',
      createdAtMs: this.clock(),
      expiresAtMs: input.expiresAtMs || null,
      baselineSummary: input.baselineSummary || {},
      stimulusSummary: input.stimulusSummary || {},
      validityState: 'valid',
      invalidationReason: null
    };
    this.records.set(record.calibrationId, record);
    return { ...record };
  }

  invalidate(calibrationId, reason = 'operator invalidation') {
    const current = this.records.get(calibrationId);
    if (!current) return null;
    const record = {
      ...current,
      revision: ++this.revision,
      validityState: 'invalidated',
      invalidationReason: reason
    };
    this.records.set(calibrationId, record);
    return { ...record };
  }

  get(calibrationId) {
    const record = this.records.get(calibrationId);
    return record ? { ...record } : null;
  }

  assess(calibrationId, context = {}) {
    return assessCalibrationCompatibility(this.records.get(calibrationId) || null, {
      ...context,
      nowMs: context.nowMs === undefined ? this.clock() : context.nowMs
    });
  }

  list() {
    return Array.from(this.records.values()).map((record) => ({ ...record }));
  }

  digest() {
    return createHash('sha256').update(encode(this.list())).digest('hex');
  }
}
