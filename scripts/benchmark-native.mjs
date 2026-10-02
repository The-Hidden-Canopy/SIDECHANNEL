import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { verifySessionPackage } from '../src/session-verifier.mjs';
import {
  NATIVE_BENCHMARK_FORMAT,
  NATIVE_BENCHMARK_VERSION,
  computeNativeBenchmarkDigest,
  verifyNativeBenchmarkReceipt
} from '../src/verification/native-benchmark.mjs';

const runProcess = promisify(execFile);
const executable = process.argv[2];
const ticks = Number(process.argv[3] || 8);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

if (!executable) {
  console.error('usage: node scripts/benchmark-native.mjs path/to/sidechannel-native[.exe] [ticks]');
  process.exit(2);
}
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10_000) {
  console.error('ticks must be between 1 and 10000');
  process.exit(2);
}
if (outputIndex >= 0 && (!outputPath || outputPath.startsWith('--'))) {
  console.error('--output requires a receipt path');
  process.exit(2);
}

async function runBackend(root, backend, args) {
  const sessionPath = join(root, backend === 'file' ? 'session.scj' : 'session.db');
  const exportPath = join(root, backend === 'file' ? 'session.json' : 'session-sqlite.json');
  const firstStart = performance.now();
  const first = await runProcess(executable, ['--ticks', String(ticks), ...args(sessionPath), '--export-json', exportPath]);
  const firstRunMs = Number((performance.now() - firstStart).toFixed(3));
  const firstReceipt = JSON.parse(first.stdout.trim().split(/\r?\n/).at(-1));
  const packageData = JSON.parse(await readFile(exportPath, 'utf8'));
  const independent = verifySessionPackage(packageData);
  if (!independent.ok || firstReceipt.verified !== true || firstReceipt.state !== 'completed') {
    throw new Error(`${backend} native benchmark package verification failed: ${JSON.stringify(independent)}`);
  }

  const reopenStart = performance.now();
  const reopened = await runProcess(executable, ['--ticks', '1', ...args(sessionPath)]);
  const reopenMs = Number((performance.now() - reopenStart).toFixed(3));
  const reopenReceipt = JSON.parse(reopened.stdout.trim().split(/\r?\n/).at(-1));
  if (reopenReceipt.state !== 'completed' || reopenReceipt.persisted !== false || reopenReceipt.verified !== true) {
    throw new Error(`${backend} native benchmark reopen did not remain completed: ${JSON.stringify(reopenReceipt)}`);
  }

  return {
    backend: backend === 'file' ? 'file' : 'sqlite-wal',
    firstRunMs,
    reopenMs,
    packageBytes: (await stat(exportPath)).size,
    observations: firstReceipt.observations,
    journalEvents: firstReceipt.journalEvents,
    independentlyVerified: true
  };
}

const root = await mkdtemp(join(tmpdir(), 'sidechannel-native-benchmark-'));
try {
  const backends = [
    await runBackend(root, 'file', (sessionPath) => ['--session-file', sessionPath]),
    await runBackend(root, 'sqlite-wal', (sessionPath) => ['--sqlite-session-file', sessionPath])
  ];
  const receipt = {
    format: NATIVE_BENCHMARK_FORMAT,
    formatVersion: NATIVE_BENCHMARK_VERSION,
    evidenceLevel: 'E2',
    tier: 'native-simulator-reference',
    runId: `native_benchmark_${Date.now()}`,
    runtimeBuildId: 'sidechannel-native-reference',
    ticks,
    backends,
    limitations: [
      'E2 native simulator and persistence receipt only; no physical source or third-party data was exercised.',
      'Process timings and package sizes are host-local measurements, not production capacity or deployment claims.'
    ]
  };
  receipt.receiptDigest = computeNativeBenchmarkDigest(receipt);
  const verification = verifyNativeBenchmarkReceipt(receipt);
  if (!verification.ok) throw new Error(`native benchmark receipt failed self-verification: ${JSON.stringify(verification)}`);
  if (outputPath) await writeFile(outputPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ receipt, verification }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
