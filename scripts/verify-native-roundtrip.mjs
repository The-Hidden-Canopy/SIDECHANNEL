import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.mjs';
import { verifySessionPackage } from '../src/session-verifier.mjs';

const executable = process.argv[2];
const ticks = Number(process.argv[3] || 2);

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

if (!executable || !Number.isInteger(ticks) || ticks < 1 || ticks > 100) {
  console.error('usage: node scripts/verify-native-roundtrip.mjs path/to/sidechannel-native[.exe] [ticks]');
  process.exit(2);
}

const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-roundtrip-'));
const nativeSessionPath = join(directory, 'native.scj');
const exportPath = join(directory, 'native.json');
const databasePath = join(directory, 'roundtrip.sqlite');
const store = new SqliteStore(databasePath);
try {
  const receipt = JSON.parse(await runNative([
    '--ticks', String(ticks), '--session-file', nativeSessionPath, '--export-json', exportPath
  ]));
  const packageData = JSON.parse(await readFile(exportPath, 'utf8'));
  const sourceVerification = verifySessionPackage(packageData);
  if (!sourceVerification.ok) throw new Error('native package failed verification before import');

  await store.init(packageData.sceneSnapshot);
  const imported = store.importPackage(packageData);
  const retained = store.getSession(imported.id);
  const importedEvidence = retained.observations.every((observation) =>
    observation.evidenceState === 'imported' &&
    observation.metadata?.importedFromSessionId === packageData.sessionId &&
    observation.provenance?.at(-1)?.relation === 'imported_from'
  );
  const roundtripOk = receipt.state === 'completed' &&
    retained.state === 'completed' &&
    retained.observations.length === packageData.observations.length &&
    importedEvidence &&
    retained.journal.at(-1)?.type === 'ImportAccepted';
  if (!roundtripOk) {
    console.error(JSON.stringify({
      ok: false,
      sourceVerification,
      nativeReceipt: receipt,
      importedSessionId: imported.id,
      retainedObservationCount: retained.observations.length,
      sourceObservationCount: packageData.observations.length,
      importedEvidence,
      lastJournalType: retained.journal.at(-1)?.type || null
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    ticks,
    sourceSessionId: packageData.sessionId,
    importedSessionId: imported.id,
    observationCount: retained.observations.length,
    sourcePackageVerified: sourceVerification.ok,
    importedEvidenceRelabelled: true,
    provenanceVerified: true,
    importJournalVerified: true
  }, null, 2));
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
