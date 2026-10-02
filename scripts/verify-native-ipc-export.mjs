import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { verifySessionPackage } from '../src/session-verifier.mjs';

const executable = process.argv[2];

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

function unhex(value) {
  return Buffer.from(value, 'hex').toString('utf8');
}

function frame(id, type, payload = '') {
  return `sidechannel.native-ipc/1\t${hex(String(id))}\t${hex('launch-token')}\t${hex(type)}\t${hex(payload)}\n`;
}

function runNative(frames, backend, sessionPath) {
  return new Promise((resolve, reject) => {
    const args = ['--ipc-stdio', 'launch-token'];
    args.push(backend === 'sqlite-wal' ? '--sqlite-session-file' : '--session-file', sessionPath);
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || `native command failed with ${code}`)));
    child.stdin.end(frames.join(''));
  });
}

function decodeResponses(output) {
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const fields = line.split('\t');
    if (fields.length !== 5 || fields[0] !== 'sidechannel.native-ipc/1') throw new Error('malformed native IPC response');
    return { type: unhex(fields[3]), payload: JSON.parse(unhex(fields[4])) };
  });
}

function requireResponse(responses, index, type) {
  const response = responses[index];
  if (!response || response.type !== type) throw new Error(`response ${index} expected ${type}`);
  return response;
}

async function verifyBackend(directory, backend) {
  const suffix = backend === 'sqlite-wal' ? 'export.db' : 'export.scj';
  const sessionPath = join(directory, suffix);
  const responses = decodeResponses(await runNative([
    frame(1, 'session.observe', 'export_obs|sim_heat|heat|1000|23.5|0.91|1'),
    frame(2, 'session.close'),
    frame(3, 'session.export'),
    frame(4, 'shutdown')
  ], backend, sessionPath));
  requireResponse(responses, 0, 'observation.accepted');
  const closed = requireResponse(responses, 1, 'session.closed');
  if (closed.payload.state !== 'completed') throw new Error(`${backend} IPC session did not close before export`);
  const exported = requireResponse(responses, 2, 'session.exported');
  const report = verifySessionPackage(exported.payload);
  if (!report.ok || !report.checks.packageDigestVerified || !report.checks.journalVerified ||
      !report.checks.observationSchemaVerified || report.checks.observationCount !== 1) {
    throw new Error(`${backend} IPC export failed independent package verification: ${JSON.stringify(report)}`);
  }
  requireResponse(responses, 3, 'stopped');
  return {
    backend,
    observationCount: report.checks.observationCount,
    journalEventCount: report.checks.journalEventCount,
    packageDigestVerified: report.checks.packageDigestVerified,
    journalVerified: report.checks.journalVerified
  };
}

if (!executable) {
  console.error('usage: node scripts/verify-native-ipc-export.mjs path/to/sidechannel-native[.exe]');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-ipc-export-'));
  try {
    const backends = [
      await verifyBackend(directory, 'file-backed'),
      await verifyBackend(directory, 'sqlite-wal')
    ];
    console.log(JSON.stringify({
      ok: true,
      protocol: 'sidechannel.native-ipc/1',
      packageFormat: 'sidechannel-session',
      backends,
      independentPackageVerification: true,
      hardwareAdaptersExercised: false
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
