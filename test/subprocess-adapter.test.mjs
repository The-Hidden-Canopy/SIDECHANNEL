import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SubprocessAdapter } from '../src/adapters/subprocess.mjs';
import { AdapterSupervisor } from '../src/adapters/supervisor.mjs';

const fixture = fileURLToPath(new URL('../fixtures/adapter-provider.mjs', import.meta.url));

function adapter(mode, options = {}) {
  return new SubprocessAdapter({
    command: process.execPath,
    args: [fixture, mode],
    ...options
  });
}

test('subprocess adapter admits versioned frames and observations', async () => {
  const frames = [];
  const observations = [];
  const result = await adapter('valid').start({ onFrame: (frame) => frames.push(frame), onObservation: (observation) => observations.push(observation) });
  assert.equal(result.ok, true);
  assert.equal(result.frames, 2);
  assert.equal(frames[1].type, 'observation');
  assert.equal(observations[0].id, 'fixture_observation');
});

test('subprocess adapter reports malformed and unsupported frames without emitting them', async () => {
  const frames = [];
  const diagnostics = [];
  const result = await adapter('invalid').start({ onFrame: (frame) => frames.push(frame), onDiagnostic: (value) => diagnostics.push(value) });
  assert.equal(result.ok, true);
  assert.equal(frames.length, 1);
  assert.ok(diagnostics.some((item) => item.message === 'adapter JSONL parse error'));
  assert.ok(diagnostics.some((item) => item.message === 'adapter frame rejected'));
});

test('subprocess adapter bounds frame bytes and can cancel a running provider', async () => {
  const oversized = await adapter('oversized', { maxLineBytes: 512 }).start();
  assert.equal(oversized.ok, true);
  assert.ok(oversized.diagnostics.some((item) =>
    item.message === 'adapter frame rejected' ||
    (item.message === 'adapter JSONL parse error' && item.detail === 'adapter line exceeds declared byte limit')
  ));
  const running = adapter('wait');
  const task = running.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const stopped = await running.stop();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state, 'STOPPED');
});

test('subprocess adapter can run under the permission-gated supervisor', async () => {
  const supervisor = new AdapterSupervisor({ failureThreshold: 2, clock: () => 1 });
  supervisor.register({
    protocolVersion: 'sidechannel.adapter/1',
    providerId: 'fixture.adapter',
    providerVersion: '0.1.0',
    capabilities: ['normalized_observation'],
    supportedUnits: ['normalized'],
    requiredPermissions: [],
    rawContentPolicy: 'none'
  });
  const processAdapter = adapter('valid', { providerId: 'fixture.adapter', supervisor });
  const result = await processAdapter.start();
  assert.equal(result.ok, true);
  assert.equal(supervisor.get('fixture.adapter').state, 'STOPPED');
});

test('permission revocation cancels an active subprocess and leaves it disabled', async () => {
  const supervisor = new AdapterSupervisor({ failureThreshold: 2, clock: () => 1 });
  supervisor.register({
    protocolVersion: 'sidechannel.adapter/1',
    providerId: 'fixture.revocable',
    providerVersion: '0.1.0',
    capabilities: ['normalized_observation'],
    supportedUnits: ['normalized'],
    requiredPermissions: ['system.power.read'],
    rawContentPolicy: 'none'
  });
  supervisor.grantPermissions('fixture.revocable', ['system.power.read']);
  const processAdapter = adapter('wait', { providerId: 'fixture.revocable', supervisor });
  const task = processAdapter.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const revocation = await supervisor.revokePermissions('fixture.revocable', ['system.power.read']);
  const result = await task;
  assert.equal(result.ok, true);
  assert.equal(result.state, 'STOPPED');
  assert.equal(revocation.adapter.state, 'DISABLED');
  assert.equal(supervisor.get('fixture.revocable').lastCancellation.reason, 'permission_revoked');
});

test('repeated subprocess crashes quarantine the provider and block restart', async () => {
  const supervisor = new AdapterSupervisor({ failureThreshold: 2, clock: () => 1 });
  supervisor.register({
    protocolVersion: 'sidechannel.adapter/1',
    providerId: 'fixture.crash',
    providerVersion: '0.1.0',
    capabilities: ['normalized_observation'],
    supportedUnits: ['normalized'],
    requiredPermissions: [],
    rawContentPolicy: 'none'
  });
  const first = adapter('crash', { providerId: 'fixture.crash', supervisor });
  const firstResult = await first.start();
  assert.equal(firstResult.ok, false);
  assert.equal(supervisor.get('fixture.crash').state, 'STOPPED');
  const second = adapter('crash', { providerId: 'fixture.crash', supervisor });
  const secondResult = await second.start();
  assert.equal(secondResult.ok, false);
  assert.equal(supervisor.get('fixture.crash').state, 'QUARANTINED');
  assert.throws(() => adapter('crash', { providerId: 'fixture.crash', supervisor }).start(), /quarantined/);
});
