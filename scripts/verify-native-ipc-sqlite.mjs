import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
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

function runNative(frames, sessionPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '--ipc-stdio', 'launch-token',
      '--sqlite-session-file', sessionPath
    ], { windowsHide: true });
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
    if (fields.length !== 5 || fields[0] !== 'sidechannel.native-ipc/1') {
      throw new Error('malformed native IPC response');
    }
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
  console.error('usage: node scripts/verify-native-ipc-sqlite.mjs path/to/sidechannel-native[.exe]');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'sidechannel-native-ipc-sqlite-'));
  const sessionPath = join(directory, 'session.db');
  try {
    const first = decodeResponses(await runNative([
      frame(1, 'session.status'),
      frame(2, 'session.observe', 'ipc_sqlite_obs|ipc_sqlite_source|heat|1000|23.5|0.91|1'),
      frame(3, 'adapter.register', 'fixture-provider|0.1.0|fixture-digest|normalized_observation|fixture.read|4096'),
      frame(4, 'adapter.grant', 'fixture-provider|fixture.read'),
      frame(5, 'adapter.start', 'fixture-provider'),
      frame(6, 'adapter.fail', 'fixture-provider|bounded fixture failure'),
      frame(7, 'session.status'),
      frame(8, 'session.verify'),
      frame(9, 'session.close'),
      frame(10, 'shutdown')
    ], sessionPath));
    const opened = requireResponse(first, 0, 'session.status');
    if (opened.payload.state !== 'recording' || opened.payload.observations !== 0 || opened.payload.journalEvents !== 1) {
      throw new Error('SQLite IPC session did not open with the expected recording state');
    }
    const accepted = requireResponse(first, 1, 'observation.accepted');
    if (accepted.payload.observations !== 1 || accepted.payload.journalEvents !== 2) {
      throw new Error('SQLite IPC observation was not transactionally admitted');
    }
    requireResponse(first, 2, 'adapter.updated');
    requireResponse(first, 3, 'adapter.updated');
    requireResponse(first, 4, 'adapter.updated');
    requireResponse(first, 5, 'adapter.updated');
    const beforeClose = requireResponse(first, 6, 'session.status');
    if (beforeClose.payload.observations !== 1 || beforeClose.payload.journalEvents < 6) {
      throw new Error('SQLite IPC adapter lifecycle was not journaled');
    }
    requireResponse(first, 7, 'session.verified');
    const closed = requireResponse(first, 8, 'session.closed');
    if (closed.payload.state !== 'completed') throw new Error('SQLite IPC session did not close');
    requireResponse(first, 9, 'stopped');

    await access(sessionPath);
    const reopened = decodeResponses(await runNative([
      frame(11, 'session.status'),
      frame(12, 'session.verify'),
      frame(13, 'session.observe', 'late_obs|late_source|heat|2000|24|0.9|1'),
      frame(14, 'shutdown')
    ], sessionPath));
    const reopenedStatus = requireResponse(reopened, 0, 'session.status');
    if (reopenedStatus.payload.state !== 'completed' || reopenedStatus.payload.observations !== 1 || reopenedStatus.payload.journalEvents < 7) {
      throw new Error('SQLite IPC session did not reopen with durable state');
    }
    requireResponse(reopened, 1, 'session.verified');
    const refused = requireResponse(reopened, 2, 'error');
    if (!refused.payload.error.includes('rejected')) throw new Error('completed SQLite IPC session returned an unexpected observation error');
    requireResponse(reopened, 3, 'stopped');

    console.log(JSON.stringify({
      ok: true,
      protocol: 'sidechannel.native-ipc/1',
      backend: 'sqlite-wal',
      observationCount: reopenedStatus.payload.observations,
      journalEvents: reopenedStatus.payload.journalEvents,
      transactionAdmissionVerified: true,
      adapterJournalAndReopenVerified: true,
      hardwareAdaptersExercised: false
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
