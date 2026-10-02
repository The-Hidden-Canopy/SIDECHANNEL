import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function runNative(frames, sessionPath = null) {
  return new Promise((resolve, reject) => {
    const args = ['--ipc-stdio', 'launch-token'];
    if (sessionPath) args.push('--session-file', sessionPath);
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
    return {
      requestId: unhex(fields[1]),
      type: unhex(fields[3]),
      payload: JSON.parse(unhex(fields[4]))
    };
  });
}

function requireResponse(responses, index, type) {
  const response = responses[index];
  if (!response || response.type !== type) throw new Error(`response ${index} expected ${type}`);
  return response;
}

if (!executable) {
  console.error('usage: node scripts/verify-native-adapter.mjs path/to/sidechannel-native[.exe]');
  process.exitCode = 2;
} else {
  try {
    const lifecycleFrames = [
      frame(1, 'adapter.register', 'fixture-provider|0.1.0|fixture-digest|normalized_observation|fixture.read|4096'),
      frame(2, 'adapter.start', 'fixture-provider'),
      frame(3, 'adapter.grant', 'fixture-provider|fixture.read'),
      frame(4, 'adapter.start', 'fixture-provider'),
      frame(5, 'adapter.fail', 'fixture-provider|malformed frame'),
      frame(6, 'adapter.fail', 'fixture-provider|provider stopped'),
      frame(7, 'adapter.fail', 'fixture-provider|third failure'),
      frame(8, 'adapter.start', 'fixture-provider'),
      frame(9, 'adapter.clear', 'fixture-provider'),
      frame(10, 'adapter.list'),
      frame(11, 'shutdown')
    ];
    const responses = decodeResponses(await runNative(lifecycleFrames));
    const registered = requireResponse(responses, 0, 'adapter.updated');
    if (registered.payload.adapter.state !== 'VALIDATED') throw new Error('registered adapter was not validated');
    const missingPermission = requireResponse(responses, 1, 'error');
    if (!missingPermission.payload.error.includes('required permissions')) throw new Error('missing permission was not rejected');
    const granted = requireResponse(responses, 2, 'adapter.updated');
    if (granted.payload.adapter.state !== 'DISABLED') throw new Error('permission grant did not disable adapter');
    const running = requireResponse(responses, 3, 'adapter.updated');
    if (running.payload.adapter.state !== 'RUNNING') throw new Error('adapter did not start');
    const firstFailure = requireResponse(responses, 4, 'adapter.updated');
    if (firstFailure.payload.adapter.failureCount !== 1) throw new Error('first failure was not counted');
    const secondFailure = requireResponse(responses, 5, 'adapter.updated');
    if (secondFailure.payload.adapter.failureCount !== 2) throw new Error('second failure was not counted');
    const quarantined = requireResponse(responses, 6, 'adapter.updated');
    if (quarantined.payload.adapter.state !== 'QUARANTINED') throw new Error('adapter was not quarantined');
    const blocked = requireResponse(responses, 7, 'error');
    if (!blocked.payload.error.includes('quarantined')) throw new Error('quarantined adapter restarted');
    const cleared = requireResponse(responses, 8, 'adapter.updated');
    if (cleared.payload.adapter.state !== 'DISABLED' || cleared.payload.adapter.failureCount !== 0) {
      throw new Error('quarantine was not explicitly cleared');
    }
    const listed = requireResponse(responses, 9, 'adapter.list');
    if (listed.payload.adapters.length !== 1 || listed.payload.adapters[0].providerId !== 'fixture-provider') {
      throw new Error('adapter list was not bounded and complete');
    }
    requireResponse(responses, 10, 'stopped');
    const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-adapter-journal-'));
    const sessionPath = join(directory, 'session.scj');
    try {
      const sessionResponses = decodeResponses(await runNative([
        ...lifecycleFrames.slice(0, -1),
        frame(12, 'session.status'),
        frame(13, 'session.verify'),
        frame(14, 'session.close'),
        frame(15, 'shutdown')
      ], sessionPath));
      const sessionQuarantined = requireResponse(sessionResponses, 6, 'adapter.updated');
      if (sessionQuarantined.payload.adapter.state !== 'QUARANTINED') throw new Error('journaled adapter was not quarantined');
      const sessionSummary = requireResponse(sessionResponses, 10, 'session.status');
      if (sessionSummary.payload.journalEvents < 8) throw new Error('adapter lifecycle was not journaled');
      requireResponse(sessionResponses, 11, 'session.verified');
      const closed = requireResponse(sessionResponses, 12, 'session.closed');
      if (closed.payload.state !== 'completed') throw new Error('journaled session did not close');
      requireResponse(sessionResponses, 13, 'stopped');
      const reopened = decodeResponses(await runNative([
        frame(16, 'session.status'),
        frame(17, 'session.verify'),
        frame(18, 'shutdown')
      ], sessionPath));
      const reopenedStatus = requireResponse(reopened, 0, 'session.status');
      if (reopenedStatus.payload.journalEvents < 8 || reopenedStatus.payload.state !== 'completed') {
        throw new Error('journaled adapter session did not reopen with durable state');
      }
      requireResponse(reopened, 1, 'session.verified');
      requireResponse(reopened, 2, 'stopped');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    console.log(JSON.stringify({
      ok: true,
      protocol: 'sidechannel.native-ipc/1',
      transitions: ['register', 'permission-reject', 'grant', 'start', 'failure', 'quarantine', 'clear', 'list'],
      quarantineRecoveryVerified: true,
      adapterJournalAndReopenVerified: true,
      hardwareAdaptersExercised: false
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
