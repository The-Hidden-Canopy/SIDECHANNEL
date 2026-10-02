import { spawn } from 'node:child_process';
import { verifySessionPackage } from '../src/session-verifier.mjs';

const executable = process.argv[2];
const ticks = Number(process.argv[3] || 2);

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
    if (!verification.ok) {
      console.error(JSON.stringify({ ok: false, verification }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        ok: true,
        ticks,
        format: packageData.format,
        observationCount: verification.checks.observationCount,
        snapshotDigestVerified: verification.checks.snapshotDigestVerified,
        packageDigestVerified: verification.checks.packageDigestVerified,
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
