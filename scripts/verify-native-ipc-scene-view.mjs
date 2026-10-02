import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

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
  const suffix = backend === 'sqlite-wal' ? 'scene.db' : 'scene.scj';
  const sessionPath = join(directory, suffix);
  const responses = decodeResponses(await runNative([
    frame(1, 'session.observe', 'scene_obs|scene_source|heat|1000|23.5|0.91|1'),
    frame(2, 'scene.view', '2|2'),
    frame(3, 'scene.view', '0|2'),
    frame(4, 'session.verify'),
    frame(5, 'session.close'),
    frame(6, 'shutdown')
  ], backend, sessionPath));
  const accepted = requireResponse(responses, 0, 'observation.accepted');
  if (accepted.payload.observations !== 1) throw new Error(`${backend} IPC observation was not admitted`);
  const view = requireResponse(responses, 1, 'scene.view');
  if (view.payload.format !== 'sidechannel.scene-view/1' ||
      view.payload.summary.sourceCount !== 1 ||
      view.payload.summary.observationCount !== 1 ||
      view.payload.summary.boundedObservationCount !== 1 ||
      view.payload.limits.maxSources !== 2 ||
      view.payload.limits.maxObservations !== 2) {
    throw new Error(`${backend} IPC scene view did not preserve bounded projection semantics`);
  }
  const invalid = requireResponse(responses, 2, 'error');
  if (!invalid.payload.error.includes('invalid scene view limits')) throw new Error(`${backend} IPC accepted invalid scene limits`);
  requireResponse(responses, 3, 'session.verified');
  requireResponse(responses, 4, 'session.closed');
  requireResponse(responses, 5, 'stopped');
  return {
    backend,
    sourceCount: view.payload.summary.sourceCount,
    observationCount: view.payload.summary.observationCount,
    boundedObservationCount: view.payload.summary.boundedObservationCount
  };
}

if (!executable) {
  console.error('usage: node scripts/verify-native-ipc-scene-view.mjs path/to/sidechannel-native[.exe]');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-ipc-scene-view-'));
  try {
    const backends = [
      await verifyBackend(directory, 'file-backed'),
      await verifyBackend(directory, 'sqlite-wal')
    ];
    console.log(JSON.stringify({
      ok: true,
      protocol: 'sidechannel.native-ipc/1',
      format: 'sidechannel.scene-view/1',
      backends,
      boundedLimitsAndInvalidInputVerified: true,
      hardwareAdaptersExercised: false
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
