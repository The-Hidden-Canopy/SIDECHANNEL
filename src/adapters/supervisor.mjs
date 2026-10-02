import { validateProviderManifest } from '../admission/manifest.mjs';

export const ADAPTER_STATES = Object.freeze([
  'DISCOVERED',
  'VALIDATED',
  'DISABLED',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'QUARANTINED'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class AdapterSupervisor {
  constructor({ failureThreshold = 3, clock = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.clock = clock;
    this.adapters = new Map();
    this.runtimeControllers = new Map();
  }

  register(rawManifest) {
    const result = validateProviderManifest(rawManifest);
    if (!result.ok) throw new Error(result.reasons.map((reason) => reason.message).join('; '));
    const current = this.adapters.get(result.manifest.providerId);
    const adapter = {
      manifest: result.manifest,
      state: 'VALIDATED',
      grantedPermissions: current?.grantedPermissions || [],
      failureCount: current?.failureCount || 0,
      lastFailure: current?.lastFailure || null,
      lastCancellation: current?.lastCancellation || null,
      lastTransitionAtMs: this.clock()
    };
    this.adapters.set(result.manifest.providerId, adapter);
    return clone(adapter);
  }

  get(providerId) {
    const adapter = this.adapters.get(providerId);
    return adapter ? clone(adapter) : null;
  }

  list() {
    return Array.from(this.adapters.values()).map((adapter) => clone(adapter));
  }

  grantPermissions(providerId, permissions = []) {
    const adapter = this.require(providerId);
    const requested = new Set(adapter.manifest.requiredPermissions);
    if (!permissions.every((permission) => requested.has(permission))) {
      throw new Error('permission grant exceeds provider manifest request');
    }
    adapter.grantedPermissions = [...new Set(permissions)];
    adapter.state = 'DISABLED';
    adapter.lastTransitionAtMs = this.clock();
    return clone(adapter);
  }

  async revokePermissions(providerId, permissions = []) {
    const adapter = this.require(providerId);
    const requested = permissions.length ? [...new Set(permissions)] : adapter.grantedPermissions.slice();
    if (!requested.every((permission) => adapter.grantedPermissions.includes(permission))) {
      throw new Error('permission revocation includes a permission that is not granted');
    }
    adapter.grantedPermissions = adapter.grantedPermissions.filter((permission) => !requested.includes(permission));
    adapter.state = 'DISABLED';
    adapter.lastTransitionAtMs = this.clock();
    const controller = this.runtimeControllers.get(providerId);
    let cancellation = null;
    if (controller) {
      cancellation = await controller.stop('permission_revoked');
    }
    this.recordCancellation(providerId, 'permission_revoked', requested);
    return { adapter: clone(adapter), cancellation };
  }

  attachRuntime(providerId, controller) {
    this.require(providerId);
    if (!controller || typeof controller.stop !== 'function') throw new TypeError('runtime controller must provide stop()');
    this.runtimeControllers.set(providerId, controller);
  }

  detachRuntime(providerId, controller) {
    if (this.runtimeControllers.get(providerId) === controller) this.runtimeControllers.delete(providerId);
  }

  recordCancellation(providerId, reason, permissions = []) {
    const adapter = this.require(providerId);
    adapter.lastCancellation = {
      reason,
      permissions: permissions.slice(),
      atMs: this.clock()
    };
    if (reason === 'permission_revoked' && adapter.state !== 'QUARANTINED') adapter.state = 'DISABLED';
    adapter.lastTransitionAtMs = this.clock();
    return clone(adapter);
  }

  start(providerId) {
    const adapter = this.require(providerId);
    if (adapter.state === 'QUARANTINED') throw new Error('adapter is quarantined');
    const missing = adapter.manifest.requiredPermissions.filter((permission) =>
      !adapter.grantedPermissions.includes(permission)
    );
    if (missing.length) {
      adapter.state = 'DISABLED';
      throw new Error('required permissions are not granted: ' + missing.join(', '));
    }
    adapter.state = 'STARTING';
    adapter.lastTransitionAtMs = this.clock();
    adapter.state = 'RUNNING';
    adapter.lastTransitionAtMs = this.clock();
    return clone(adapter);
  }

  stop(providerId) {
    const adapter = this.require(providerId);
    if (adapter.state === 'RUNNING' || adapter.state === 'STARTING') {
      adapter.state = 'STOPPING';
      adapter.lastTransitionAtMs = this.clock();
    }
    adapter.state = 'STOPPED';
    adapter.lastTransitionAtMs = this.clock();
    return clone(adapter);
  }

  recordFailure(providerId, reason) {
    const adapter = this.require(providerId);
    adapter.failureCount += 1;
    adapter.lastFailure = { reason, atMs: this.clock() };
    if (adapter.failureCount >= this.failureThreshold) adapter.state = 'QUARANTINED';
    return clone(adapter);
  }

  recordSuccess(providerId) {
    const adapter = this.require(providerId);
    adapter.failureCount = 0;
    adapter.lastFailure = null;
    return clone(adapter);
  }

  clearQuarantine(providerId) {
    const adapter = this.require(providerId);
    if (adapter.state !== 'QUARANTINED') return clone(adapter);
    adapter.state = 'DISABLED';
    adapter.failureCount = 0;
    adapter.lastFailure = null;
    adapter.lastTransitionAtMs = this.clock();
    return clone(adapter);
  }

  require(providerId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error('adapter not registered: ' + providerId);
    return adapter;
  }
}
