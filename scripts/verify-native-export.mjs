import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySessionPackage } from '../src/session-verifier.mjs';
import { createSimulator } from '../src/simulator.mjs';

const executable = process.argv[2];
const ticks = Number(process.argv[3] || 2);

function expectedObservations(tickCount) {
  const expected = [];
  let clockTick = 0;
  const simulator = createSimulator({
    clock: () => clockTick * 250,
    intervalMs: 60_000,
    emit: (observation) => expected.push(observation)
  });
  for (clockTick = 0; clockTick < tickCount; clockTick += 1) simulator.step();
  return expected;
}

function compareCanonicalObservations(actual, expected) {
  const reasons = [];
  if (actual.length !== expected.length) reasons.push(`row count ${actual.length} != ${expected.length}`);
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    const row = actual[index];
    const wanted = expected[index];
    for (const field of ['schema', 'id', 'sourceId', 'channel', 'unit', 'status']) {
      if (row[field] !== wanted[field]) reasons.push(`${field} mismatch at row ${index}`);
    }
    if (row.timestampMs !== wanted.timestampMs) reasons.push(`timestamp mismatch at row ${index}`);
    if (Math.abs(row.value - wanted.value) > 0.0001) reasons.push(`value mismatch at row ${index}`);
    if (Math.abs(row.quality?.score - wanted.quality.score) > 0.0001) reasons.push(`quality mismatch at row ${index}`);
    if (row.quality?.state !== wanted.quality.state) reasons.push(`quality state mismatch at row ${index}`);
    if (row.evidenceState !== 'simulated') reasons.push(`evidence state mismatch at row ${index}`);
    if (row.sequence !== index + 1) reasons.push(`sequence mismatch at row ${index}`);
  }
  return reasons;
}

function runNative(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || `native command failed with ${code}`)));
  });
}

function runNativeWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || `native command failed with ${code}`)));
    child.stdin.end(input);
  });
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

if (!executable || !Number.isInteger(ticks) || ticks < 1 || ticks > 100) {
  console.error('usage: node scripts/verify-native-export.mjs path/to/sidechannel-native[.exe] [ticks]');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-export-'));
  const sessionPath = join(directory, 'session.scj');
  const exportPath = join(directory, 'session.json');
  const interruptedSessionPath = join(directory, 'interrupted.scj');
  const interruptedExportPath = join(directory, 'interrupted.json');
  try {
    const receipt = JSON.parse(await runNative([
      '--ticks', String(ticks), '--session-file', sessionPath, '--export-json', exportPath
    ]));
    const packageData = JSON.parse(await readFile(exportPath, 'utf8'));
    const verification = verifySessionPackage(packageData);
    const semanticReasons = compareCanonicalObservations(packageData.observations || [], expectedObservations(ticks));
    await runNativeWithInput(
      ['--ipc-stdio', 'launch-token', '--session-file', interruptedSessionPath],
      [
        `sidechannel.native-ipc/1\t31\t${hex('launch-token')}\t${hex('session.observe')}\t${hex('ipc_obs|ipc_source|heat|1000|23.5|0.91|1')}\n`,
        `sidechannel.native-ipc/1\t32\t${hex('launch-token')}\t${hex('shutdown')}\t\n`
      ].join('')
    );
    let interruptedExportRefused = false;
    try {
      await runNative(['--ticks', '1', '--session-file', interruptedSessionPath, '--export-json', interruptedExportPath]);
    } catch (error) {
      interruptedExportRefused = error.message.includes('completed session');
    }
    if (!receipt.exported || receipt.state !== 'completed' || !verification.ok || semanticReasons.length || !interruptedExportRefused) {
      console.error(JSON.stringify({
        ok: false,
        receipt,
        verification,
        semanticParity: { ok: semanticReasons.length === 0, reasons: semanticReasons }
      }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        ok: true,
        ticks,
        format: packageData.format,
        observationCount: verification.checks.observationCount,
        snapshotDigestVerified: verification.checks.snapshotDigestVerified,
        packageDigestVerified: verification.checks.packageDigestVerified,
        journalVerified: verification.checks.journalVerified,
        semanticParityVerified: true,
        interruptedExportRefusedByContract: interruptedExportRefused,
        warnings: verification.warnings
      }, null, 2));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
