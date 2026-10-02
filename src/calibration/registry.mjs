import { createHash, randomUUID } from 'node:crypto';

function encode(value) {
  return JSON.stringify(value ?? null);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
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
    const record = {
      schemaVersion: '0.1',
      calibrationId: input.calibrationId || 'cal_' + randomUUID(),
      revision: ++this.revision,
      sourceId: input.sourceId,
      sourceProfileDigest: input.sourceProfileDigest || null,
      providerDigest: input.providerDigest || null,
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

  list() {
    return Array.from(this.records.values()).map((record) => ({ ...record }));
  }

  digest() {
    return createHash('sha256').update(encode(this.list())).digest('hex');
  }
}
