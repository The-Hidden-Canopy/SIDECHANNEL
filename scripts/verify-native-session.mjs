import { spawn } from 'node:child_process';
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

if (!executable || !Number.isInteger(ticks) || ticks < 1 || ticks > 100) {
  console.error('usage: node scripts/verify-native-session.mjs path/to/sidechannel-native[.exe] [ticks]');
  process.exitCode = 2;
} else {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--ticks', String(ticks), '--session-json'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || 'native session command failed')));
  });

  let packageData;
  try {
    packageData = JSON.parse(output);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reasons: ['native session JSON is invalid: ' + error.message] }, null, 2));
    process.exitCode = 1;
  }
  if (packageData) {
    const verification = verifySessionPackage(packageData);
    const semanticReasons = compareCanonicalObservations(packageData.observations || [], expectedObservations(ticks));
    if (!verification.ok || semanticReasons.length) {
      console.error(JSON.stringify({ ok: false, verification, semanticParity: { ok: semanticReasons.length === 0, reasons: semanticReasons } }, null, 2));
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
        semanticParityFields: ['schema', 'id', 'sourceId', 'channel', 'unit', 'status', 'timestampMs', 'value', 'quality', 'evidenceState', 'sequence'],
        observationSchemaVerified: verification.checks.observationSchemaVerified,
        referencesVerified: verification.checks.sourceReferencesVerified &&
          verification.checks.calibrationReferencesVerified &&
          verification.checks.provenanceReferencesVerified &&
          verification.checks.poseReferencesVerified,
        warnings: verification.warnings
      }, null, 2));
    }
  }
}
