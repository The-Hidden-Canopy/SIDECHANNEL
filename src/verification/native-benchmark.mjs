import { createHash } from 'node:crypto';

export const NATIVE_BENCHMARK_FORMAT = 'sidechannel-native-benchmark-receipt';
export const NATIVE_BENCHMARK_VERSION = '0.1';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function computeNativeBenchmarkDigest(receipt) {
  const copy = { ...receipt };
  delete copy.receiptDigest;
  return digest(copy);
}

export function verifyNativeBenchmarkReceipt(receipt) {
  const reasons = [];
  if (!receipt || receipt.format !== NATIVE_BENCHMARK_FORMAT) reasons.push('invalid native benchmark receipt format');
  if (receipt?.formatVersion !== NATIVE_BENCHMARK_VERSION) reasons.push('unsupported native benchmark receipt version');
  if (receipt?.evidenceLevel !== 'E2') reasons.push('native benchmark receipt must be E2');
  if (receipt?.tier !== 'native-simulator-reference') reasons.push('native benchmark receipt must be native-simulator-reference');
  for (const field of ['runId', 'runtimeBuildId']) {
    if (typeof receipt?.[field] !== 'string' || receipt[field].length === 0) reasons.push('missing native benchmark field: ' + field);
  }
  if (!Number.isInteger(receipt?.ticks) || receipt.ticks < 1 || receipt.ticks > 10_000) {
    reasons.push('ticks outside native benchmark bounds');
  }
  if (!Array.isArray(receipt?.backends) || receipt.backends.length !== 2) {
    reasons.push('native benchmark must contain file and SQLite backends');
  } else {
    const names = receipt.backends.map((backend) => backend?.backend).sort();
    if (JSON.stringify(names) !== JSON.stringify(['file', 'sqlite-wal'])) reasons.push('native benchmark backends are incomplete');
    for (const backend of receipt.backends) {
      if (!backend || typeof backend.backend !== 'string') {
        reasons.push('native benchmark backend is malformed');
        continue;
      }
      for (const field of ['firstRunMs', 'reopenMs', 'packageBytes']) {
        if (!Number.isFinite(backend[field]) || backend[field] < 0) reasons.push(`invalid native benchmark metric: ${backend.backend}.${field}`);
      }
      for (const field of ['observations', 'journalEvents']) {
        if (!Number.isInteger(backend[field]) || backend[field] < 1) reasons.push(`invalid native benchmark count: ${backend.backend}.${field}`);
      }
      if (backend.journalEvents < backend.observations) reasons.push(`journal count is below observation count: ${backend.backend}`);
      if (backend.independentlyVerified !== true) reasons.push(`backend was not independently verified: ${backend.backend}`);
    }
  }
  if (!Array.isArray(receipt?.limitations) || receipt.limitations.length < 2) reasons.push('native benchmark limitations are missing');
  if (typeof receipt?.receiptDigest !== 'string' || receipt.receiptDigest.length !== 64) {
    reasons.push('missing native benchmark receipt digest');
  } else if (computeNativeBenchmarkDigest(receipt) !== receipt.receiptDigest) {
    reasons.push('native benchmark receipt digest mismatch');
  }
  return { ok: reasons.length === 0, reasons, receiptDigest: receipt?.receiptDigest || null };
}
