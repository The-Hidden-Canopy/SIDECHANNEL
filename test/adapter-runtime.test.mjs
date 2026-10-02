import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderManifest } from '../src/admission/manifest.mjs';
import { validateAdapterFrame } from '../src/adapters/protocol.mjs';
import { AdapterSupervisor } from '../src/adapters/supervisor.mjs';

test('adapter protocol validates bounded versioned frames', () => {
  const result = validateAdapterFrame({
    protocolVersion: 'sidechannel.adapter/1',
    type: 'observation',
    payload: { observationId: 'obs_1' }
  });
  assert.equal(result.ok, true);
  assert.equal(validateAdapterFrame({ protocolVersion: 'bad', type: 'unknown' }).ok, false);
  assert.equal(validateAdapterFrame({ protocolVersion: 'sidechannel.adapter/1', type: 'health', payload: { text: '12345' } }, { maxBytes: 20 }).ok, false);
});

test('adapter supervisor requires permissions and quarantines repeated failures', () => {
  const supervisor = new AdapterSupervisor({ failureThreshold: 2, clock: () => 1000 });
  const manifest = createProviderManifest({
    providerId: 'fixture.power',
    capabilities: ['watts'],
    requiredPermissions: ['system.power.read']
  });
  assert.equal(supervisor.register(manifest).state, 'VALIDATED');
  assert.throws(() => supervisor.start(manifest.providerId), /permissions/);
  assert.equal(supervisor.grantPermissions(manifest.providerId, ['system.power.read']).state, 'DISABLED');
  assert.equal(supervisor.start(manifest.providerId).state, 'RUNNING');
  supervisor.recordFailure(manifest.providerId, 'malformed frame');
  assert.equal(supervisor.recordFailure(manifest.providerId, 'timeout').state, 'QUARANTINED');
  assert.throws(() => supervisor.start(manifest.providerId), /quarantined/);
  assert.equal(supervisor.clearQuarantine(manifest.providerId).state, 'DISABLED');
});
