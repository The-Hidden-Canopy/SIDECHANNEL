import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFreshness, validateObservation } from './validation.mjs';
import { createDefaultScene, createSimulator } from './simulator.mjs';
import { SqliteStore } from './sqlite-store.mjs';
import { consumeTextFrames, encodeCloseFrame, encodeControlFrame, encodeTextFrame } from './websocket.mjs';
import { listAdapters } from './adapters/registry.mjs';
import { createEventDetector } from './events.mjs';
import { createIngressSequencer } from './admission/sequencer.mjs';
import { createProviderManifest, validateProviderManifest } from './admission/manifest.mjs';
import { CalibrationRegistry } from './calibration/registry.mjs';
import { TransformGraph } from './spatial/transform-graph.mjs';
import { computePackageDigest, verifySessionPackage } from './session-verifier.mjs';
import { createRateLimiter, hasValidLaunchToken, isAllowedLoopbackHost, isAllowedOrigin } from './security.mjs';
import { AdapterSupervisor } from './adapters/supervisor.mjs';
import { compareRecomputedArtifacts, createHistoricalReplay, recomputeSession, verifyDeterminism } from './replay.mjs';
import { createReplayReceipt } from './verification/receipt.mjs';
import { runBurstBenchmark, runSoftwareBenchmark, verifyBurstBenchmarkReceipt, verifySoftwareBenchmarkReceipt } from './verification/benchmark.mjs';
import { capabilitySnapshot } from './capabilities.mjs';
import { computeSourceProfileDigest, withSourceProfileDigest } from './identity/source-profile.mjs';
import { PoseHistory } from './spatial/pose-history.mjs';
import { SCENE_UNITS, validateRegion, validateRegions } from './spatial/regions.mjs';
import { validatePortal, validatePortals } from './spatial/portals.mjs';
import { validateBackground } from './spatial/background.mjs';
import { decryptSessionPackage, encryptSessionPackage } from './session-crypto.mjs';
import { createCoOccurrenceArtifact } from './evaluation/cooccurrence.mjs';
import { runFaultCampaign, verifyFaultCampaignReceipt } from './verification/faults.mjs';
import { interpolateAdaptiveActivityField } from './spatial/adaptive.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const dataFile = join(root, 'data', 'sidechannel.sqlite');
const legacyDataFile = join(root, 'data', 'sidechannel.json');
const port = Number(process.env.PORT || 4173);
const launchToken = randomUUID();
const store = new SqliteStore(dataFile, { legacyJsonPath: legacyDataFile });
const defaultScene = createDefaultScene();

await store.init(defaultScene);

const storedScene = store.getScene(defaultScene.id) || defaultScene;
let activeScene = {
  ...storedScene,
  sources: storedScene.sources.map((source) => withSourceProfileDigest(source))
};
let simulator = null;
let recordingSessionId = null;
const latest = new Map();
const diagnostics = [];
const recentEvents = [];
const clients = new Set();
const eventDetector = createEventDetector();
const calibrationRegistry = new CalibrationRegistry();
const transformGraph = new TransformGraph();
const poseHistory = new PoseHistory();
const adapterSupervisor = new AdapterSupervisor();
const ingestClients = new Set();
const MAX_LIVE_CLIENTS = 32;
const MAX_INGEST_CLIENTS = 16;
const MAX_WEBSOCKET_BUFFER_BYTES = 2_000_000;
let admissionSequence = 0;
const admittedIds = new Set();

for (const adapter of listAdapters()) {
  adapterSupervisor.register(createProviderManifest({
    providerId: 'builtin:' + adapter.type,
    capabilities: adapter.capabilities
  }));
}

function sourceMap() {
  return new Map(activeScene.sources.map((source) => [source.id, withSourceProfileDigest(source)]));
}

function currentObservations() {
  const sources = sourceMap();
  return Array.from(latest.values()).map((observation) =>
    applyFreshness(observation, sources.get(observation.sourceId), Date.now())
  );
}

function activateScene(scene) {
  activeScene = {
    ...scene,
    sources: (scene.sources || []).map((source) => withSourceProfileDigest(source))
  };
  latest.clear();
  diagnostics.length = 0;
  recentEvents.length = 0;
  admittedIds.clear();
  admissionSequence = 0;
  if (simulator) simulator.stop();
  simulator = createSimulator({
    sources: activeScene.sources.filter((source) => source.adapterType === 'simulator'),
    emit: (observation) => {
      ingest(observation).catch((error) => diagnostics.push({
        type: 'simulator.error',
        message: error.message,
        receivedAtMs: Date.now()
      }));
    }
  });
  simulator.start();
  broadcast({ type: 'scene.updated', scene: activeScene });
  return activeScene;
}

function snapshot({ compact = false } = {}) {
  const base = {
    scene: activeScene,
    observations: currentObservations(),
    events: recentEvents.slice(-40),
    diagnostics: diagnostics.slice(-40),
    recording: recordingSessionId
      ? { id: recordingSessionId, state: 'recording' }
      : null,
    scenes: store.listScenes(),
    sessions: store.listSessions(),
    server: {
      nowMs: Date.now(),
      loopbackOnly: true,
      simulator: true,
      launchToken
    }
  };
  if (compact) return base;
  return {
    ...base,
    calibrations: calibrationRegistry.list(),
    transforms: transformGraph.snapshot(),
    poses: poseHistory.snapshot(),
    adapterRuntime: adapterSupervisor.list(),
    ingress: ingressSequencer.receipt(),
    capabilities: capabilitySnapshot(),
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType });
  response.end(value);
}

async function bodyJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2_000_000) throw new Error('request body exceeds 2 MB');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function broadcast(event) {
  const frame = encodeTextFrame(event);
  for (const socket of clients) {
    try {
      socket.write(frame);
    } catch {
      clients.delete(socket);
    }
  }
}

function recordDiagnostic(diagnostic) {
  diagnostics.push(diagnostic);
  if (recordingSessionId && diagnostic?.type === 'observation.rejected') {
    appendRuntimeEvent('ObservationRejected', {
      observationId: diagnostic.id || 'unknown',
      reasons: (Array.isArray(diagnostic.reasons) ? diagnostic.reasons : []).slice(0, 8).map((item) => ({
        id: item?.id || 'rejected',
        message: item?.message || String(item)
      }))
    }, diagnostic.receivedAtMs || Date.now());
  }
  broadcast(diagnostic);
  return { ok: false, diagnostic };
}

function appendRuntimeEvent(type, payload = {}, timestampMs = Date.now()) {
  if (!recordingSessionId) return null;
  return store.appendRuntimeEvent(recordingSessionId, type, payload, timestampMs);
}

function sourceRevisionPayload(source) {
  return {
    id: source.id,
    name: source.name,
    adapterType: source.adapterType,
    channels: Array.isArray(source.channels) ? source.channels.slice(0, 32) : [],
    unit: source.unit || null,
    range: Array.isArray(source.range) ? source.range.slice(0, 2) : null,
    freshnessWindowMs: source.freshnessWindowMs,
    privacyMode: source.privacyMode,
    privacyClass: source.privacyClass || null,
    spatialPolicy: source.spatialPolicy,
    poseMaxAgeMs: source.poseMaxAgeMs ?? null,
    poseFrameId: source.poseFrameId || null,
    position: source.position || null,
    calibrationState: source.calibrationState,
    sourceProfileDigest: source.sourceProfileDigest || null,
    providerManifest: source.providerManifest || null
  };
}

function recordAdapterFailure(providerId, reason) {
  const adapter = adapterSupervisor.recordFailure(providerId, reason);
  const diagnostic = {
    type: 'adapter.failure',
    providerId,
    state: adapter.state,
    failureCount: adapter.failureCount,
    reasons: [{ id: 'adapter.failure', message: reason }],
    receivedAtMs: Date.now()
  };
  recordDiagnostic(diagnostic);
  if (recordingSessionId) {
    appendRuntimeEvent('AdapterFailure', {
      providerId,
      reason,
      state: adapter.state,
      failureCount: adapter.failureCount
    }, diagnostic.receivedAtMs);
    if (adapter.state === 'QUARANTINED') {
      appendRuntimeEvent('AdapterQuarantined', {
        providerId,
        reason,
        failureCount: adapter.failureCount
      }, diagnostic.receivedAtMs);
    }
  }
  broadcast({ type: 'adapter.runtime', adapter });
  return adapter;
}

async function processObservation(raw) {
  const sources = sourceMap();
  const source = sources.get(raw?.sourceId);
  let resolvedPose = null;
  let admissionRaw = raw;
  if (raw?.position === undefined && typeof raw?.sourceId === 'string' && Number.isFinite(raw?.timestampMs)) {
    const pose = poseHistory.resolve(raw.sourceId, raw.timestampMs, {
      maxAgeMs: source?.poseMaxAgeMs ?? 2000,
      frameId: source?.poseFrameId || null
    });
    if (pose.ok) {
      resolvedPose = pose.sample;
      admissionRaw = {
        ...raw,
        position: { ...pose.sample.position },
        poseRef: pose.sample.sampleId,
        poseFrameId: pose.sample.frameId,
        poseDistanceMs: pose.distanceMs,
        provenance: [
          ...(Array.isArray(raw.provenance) ? raw.provenance : []),
          { parentId: pose.sample.sampleId, relation: 'transformed_by' }
        ]
      };
    } else if (source?.spatialPolicy === 'pose_required' || raw?.poseRequired === true) {
      return recordDiagnostic({
        type: 'observation.rejected',
        id: raw?.id || 'unknown',
        reasons: [pose.reason],
        receivedAtMs: Date.now()
      });
    }
  }
  const result = validateObservation(admissionRaw, { sources });
  if (!result.ok) {
    return recordDiagnostic({
      type: 'observation.rejected',
      id: result.id,
      reasons: result.reasons,
      receivedAtMs: Date.now()
    });
  }

  if (typeof raw?.calibrationRef === 'string') {
    const compatibility = calibrationRegistry.assess(raw.calibrationRef, {
      providerDigest: result.observation.provider.digest,
      sourceProfileDigest: source ? computeSourceProfileDigest(source) : null,
      transformRevision: transformGraph.revision
    });
    if (!compatibility.ok) {
      return recordDiagnostic({
        type: 'observation.rejected',
        id: result.observation.id,
        reasons: compatibility.reasons,
        calibrationCompatibility: compatibility,
        receivedAtMs: Date.now()
      });
    }
  }

  if (admittedIds.has(result.observation.id)) {
    return recordDiagnostic({
      type: 'observation.rejected',
      id: result.observation.id,
      reasons: [{ id: 'id.duplicate', message: 'observation id was already admitted' }],
      receivedAtMs: Date.now()
    });
  }

  admittedIds.add(result.observation.id);
  if (admittedIds.size > 4096) admittedIds.delete(admittedIds.values().next().value);
  const observation = {
    ...result.observation,
    ...(source ? { sourceProfileDigest: computeSourceProfileDigest(source) } : {}),
    transformRevision: transformGraph.revision,
    sequence: ++admissionSequence
  };
  latest.set(observation.sourceId + ':' + observation.channel, observation);
  if (recordingSessionId && resolvedPose) store.appendPose(recordingSessionId, resolvedPose);
  if (recordingSessionId) await store.appendObservation(recordingSessionId, observation);
  broadcast({ type: 'observation.accepted', observation });
  const event = eventDetector.observe(observation, sources.get(observation.sourceId));
  if (event) {
    recentEvents.push(event);
    if (recordingSessionId) await store.appendEvent(recordingSessionId, event);
    broadcast({ type: 'event.detected', event });
  }
  return { ok: true, observation };
}

const ingressSequencer = createIngressSequencer({
  maxQueue: 512,
  process: processObservation,
  onDrop(raw, depth) {
    return recordDiagnostic({
      type: 'observation.rejected',
      id: raw?.id || 'unknown',
      reasons: [{ id: 'ingress.queue_full', message: 'bounded ingress queue is full at depth ' + depth }],
      receivedAtMs: Date.now()
    });
  }
});

function ingest(raw) {
  return ingressSequencer.enqueue(raw);
}

function sessionPackage(session) {
  const scene = session.sceneSnapshot || activeScene;
  const sources = session.sourceRegistrySnapshot || scene.sources || [];
  const privacyClasses = Array.from(new Set(session.observations.map((observation) => observation.privacyClass || 'local_numeric'))).sort();
  const packageData = {
    format: 'sidechannel-session',
    formatVersion: '0.2',
    sessionId: session.id,
    scene,
    sources,
    sceneSnapshot: session.sceneSnapshot,
    sourceRegistrySnapshot: session.sourceRegistrySnapshot,
    calibrationRegistrySnapshot: session.calibrationRegistrySnapshot,
    transformGraphSnapshot: session.transformGraphSnapshot,
    runtimeBuildId: session.runtimeBuildId,
    schemaSetDigest: session.schemaSetDigest,
    snapshotDigest: session.snapshotDigest,
    historicalSnapshotComplete: session.snapshotComplete,
    sessionState: session.state,
    interruptionReason: session.interruptionReason,
    poses: session.poses || [],
    journal: session.journal,
    observations: session.observations,
    events: session.events,
    createdAtMs: session.startedAtMs,
    privacy: {
      classes: privacyClasses,
      rawAudioIncluded: false,
      networkPayloadsIncluded: false,
      persistentDeviceIdsIncluded: false
    }
  };
  packageData.packageDigest = computePackageDigest(packageData);
  return packageData;
}

async function handleApi(request, response, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (request.method === 'GET' && pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true,
      service: 'sidechannel',
      loopbackOnly: true,
      simulator: true,
      nowMs: Date.now(),
      launchToken
    });
  }
  if (request.method === 'GET' && pathname === '/api/capabilities') {
    return sendJson(response, 200, capabilitySnapshot());
  }
  if (request.method === 'GET' && pathname === '/api/state') {
    const view = new URL(request.url, 'http://127.0.0.1').searchParams.get('view');
    return sendJson(response, 200, snapshot({ compact: view === 'compact' }));
  }
  if (request.method === 'GET' && pathname === '/api/adapters') {
    return sendJson(response, 200, { adapters: listAdapters() });
  }
  if (request.method === 'GET' && pathname === '/api/adapter-runtime') {
    return sendJson(response, 200, { adapters: adapterSupervisor.list() });
  }
  if (request.method === 'GET' && pathname === '/api/ingress') {
    return sendJson(response, 200, { receipt: ingressSequencer.receipt() });
  }
  if (request.method === 'POST' && pathname === '/api/benchmark') {
    const body = await bodyJson(request);
    try {
      const receipt = runSoftwareBenchmark({
        ticks: body.ticks === undefined ? 8 : Number(body.ticks),
        gridSize: body.gridSize === undefined ? 14 : Number(body.gridSize),
        sourceCount: body.sourceCount === undefined ? 9 : Number(body.sourceCount),
        seed: body.seed === undefined ? 1337 : Number(body.seed),
        sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
      });
      return sendJson(response, 200, { receipt, verification: verifySoftwareBenchmarkReceipt(receipt) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/benchmark/burst') {
    const body = await bodyJson(request);
    try {
      const receipt = await runBurstBenchmark({
        frames: body.frames === undefined ? 10_000 : Number(body.frames),
        sourceCount: body.sourceCount === undefined ? 8 : Number(body.sourceCount),
        queueCapacity: body.queueCapacity === undefined ? 1_024 : Number(body.queueCapacity),
        seed: body.seed === undefined ? 1337 : Number(body.seed),
        sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
      });
      return sendJson(response, 200, { receipt, verification: verifyBurstBenchmarkReceipt(receipt) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'adapter-runtime' && parts[2] && parts[3]) {
    const providerId = decodeURIComponent(parts[2]);
    try {
      const body = parts[3] === 'grant' || parts[3] === 'revoke' || parts[3] === 'failure' ? await bodyJson(request) : {};
      let adapter;
      let cancellation = null;
      if (parts[3] === 'grant') {
        adapter = adapterSupervisor.grantPermissions(providerId, body.permissions || []);
        appendRuntimeEvent('PermissionGranted', { providerId, permissions: adapter.grantedPermissions });
      }
      else if (parts[3] === 'revoke') {
        const result = await adapterSupervisor.revokePermissions(providerId, body.permissions || []);
        adapter = result.adapter;
        cancellation = result.cancellation;
        appendRuntimeEvent('PermissionRevoked', {
          providerId,
          permissions: adapter.lastCancellation?.permissions || body.permissions || [],
          cancellation: adapter.lastCancellation?.reason || 'permission_revoked'
        });
      }
      else if (parts[3] === 'start') {
        adapter = adapterSupervisor.start(providerId);
        appendRuntimeEvent('ProviderStarted', { providerId });
      }
      else if (parts[3] === 'stop') {
        adapter = adapterSupervisor.stop(providerId);
        appendRuntimeEvent('ProviderStopped', { providerId });
      }
      else if (parts[3] === 'success') adapter = adapterSupervisor.recordSuccess(providerId);
      else if (parts[3] === 'failure') adapter = recordAdapterFailure(providerId, body.reason || 'operator-reported failure');
      else if (parts[3] === 'clear-quarantine') adapter = adapterSupervisor.clearQuarantine(providerId);
      else return sendJson(response, 400, { error: 'unsupported adapter runtime action' });
      return sendJson(response, 200, { adapter, ...(cancellation ? { cancellation } : {}) });
    } catch (error) {
      return sendJson(response, error.message.startsWith('adapter not registered:') ? 404 : 422, { error: error.message });
    }
  }
  if (request.method === 'GET' && pathname === '/api/calibrations') {
    return sendJson(response, 200, { revision: calibrationRegistry.revision, calibrations: calibrationRegistry.list() });
  }
  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'calibrations' && parts[2] && parts[3] === 'compatibility') {
    const calibrationId = decodeURIComponent(parts[2]);
    const query = new URL(request.url, 'http://127.0.0.1').searchParams;
    const compatibility = calibrationRegistry.assess(calibrationId, {
      providerDigest: query.get('providerDigest'),
      sourceProfileDigest: query.get('sourceProfileDigest'),
      transformRevision: transformGraph.revision
    });
    return sendJson(response, compatibility.status === 'missing' ? 404 : 200, compatibility);
  }
  if (request.method === 'POST' && pathname === '/api/calibrations') {
    const body = await bodyJson(request);
    try {
      const source = typeof body.sourceId === 'string' ? sourceMap().get(body.sourceId) : null;
      const runtimeSourceProfileDigest = source ? computeSourceProfileDigest(source) : null;
      const runtimeProviderDigest = source?.providerManifest?.providerDigest || null;
      const runtimeTransformRevision = transformGraph.revision;
      if (source && body.sourceProfileDigest && body.sourceProfileDigest !== runtimeSourceProfileDigest) {
        return sendJson(response, 422, {
          error: 'sourceProfileDigest does not match the current source profile',
          sourceProfileDigest: runtimeSourceProfileDigest
        });
      }
      if (source && body.providerDigest && runtimeProviderDigest && body.providerDigest !== runtimeProviderDigest) {
        return sendJson(response, 422, {
          error: 'providerDigest does not match the current provider manifest',
          providerDigest: runtimeProviderDigest
        });
      }
      if (body.transformRevision !== undefined && body.transformRevision !== runtimeTransformRevision) {
        return sendJson(response, 422, {
          error: 'transformRevision does not match the current transform graph',
          transformRevision: runtimeTransformRevision
        });
      }
      const calibration = calibrationRegistry.publish({
        ...body,
        ...(runtimeSourceProfileDigest ? { sourceProfileDigest: runtimeSourceProfileDigest } : {}),
        ...(runtimeProviderDigest ? { providerDigest: runtimeProviderDigest } : {}),
        transformRevision: runtimeTransformRevision
      });
      appendRuntimeEvent('CalibrationPublished', {
        calibrationId: calibration.calibrationId,
        revision: calibration.revision,
        sourceId: calibration.sourceId,
        providerDigest: calibration.providerDigest,
        sourceProfileDigest: calibration.sourceProfileDigest,
        transformRevision: calibration.transformRevision
      }, calibration.createdAtMs);
      return sendJson(response, 201, calibration);
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'GET' && pathname === '/api/transforms') {
    return sendJson(response, 200, transformGraph.snapshot());
  }
  if (request.method === 'GET' && pathname === '/api/poses') {
    return sendJson(response, 200, poseHistory.snapshot());
  }
  if (request.method === 'POST' && pathname === '/api/poses') {
    const body = await bodyJson(request);
    const sources = sourceMap();
    if (sources.size > 0 && !sources.has(body.sourceId)) {
      return sendJson(response, 422, { error: 'pose sourceId is not registered' });
    }
    const result = poseHistory.add(body);
    if (!result.ok) return sendJson(response, 422, result);
    appendRuntimeEvent('PoseSampleRecorded', {
      sampleId: result.sample.sampleId,
      sourceId: result.sample.sourceId,
      timestampMs: result.sample.timestampMs,
      frameId: result.sample.frameId
    }, result.sample.timestampMs);
    return sendJson(response, 201, result.sample);
  }
  if (request.method === 'POST' && pathname === '/api/transforms') {
    const body = await bodyJson(request);
    try {
      const transform = transformGraph.publish(body);
      appendRuntimeEvent('TransformRevisionPublished', {
        transformId: transform.transformId,
        revision: transform.revision,
        fromFrame: transform.fromFrame,
        toFrame: transform.toFrame,
        calibrationRef: transform.calibrationRef
      }, transform.validFrom);
      return sendJson(response, 201, transform);
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'calibrations' && parts[2] && parts[3] === 'invalidate') {
    const body = await bodyJson(request);
    const calibration = calibrationRegistry.invalidate(parts[2], body.reason || 'operator invalidation');
    if (calibration) {
      appendRuntimeEvent('CalibrationInvalidated', {
        calibrationId: calibration.calibrationId,
        revision: calibration.revision,
        reason: calibration.invalidationReason
      });
    }
    return sendJson(response, calibration ? 200 : 404, calibration || { error: 'calibration not found' });
  }
  if (request.method === 'GET' && pathname === '/api/scenes') {
    return sendJson(response, 200, { scenes: store.listScenes() });
  }
  if (request.method === 'POST' && pathname === '/api/scenes') {
    if (recordingSessionId) return sendJson(response, 409, { error: 'stop the active recording before switching scenes' });
    const body = await bodyJson(request);
    const sceneWidth = Number(body.width ?? defaultScene.width);
    const sceneHeight = Number(body.height ?? defaultScene.height);
    const sceneUnit = body.unit ?? defaultScene.unit;
    if (!SCENE_UNITS.includes(sceneUnit)) return sendJson(response, 422, { error: 'unsupported scene unit' });
    const regionResult = validateRegions(Array.isArray(body.regions) ? body.regions : [], {
      width: sceneWidth,
      height: sceneHeight
    });
    if (!regionResult.ok) return sendJson(response, 422, { error: 'invalid scene regions', reasons: regionResult.reasons });
    const portalResult = validatePortals(Array.isArray(body.portals) ? body.portals : [], {
      width: sceneWidth,
      height: sceneHeight
    });
    if (!portalResult.ok) return sendJson(response, 422, { error: 'invalid scene portals', reasons: portalResult.reasons });
    const backgroundResult = validateBackground(body.background ?? defaultScene.background, {
      width: sceneWidth,
      height: sceneHeight
    });
    if (!backgroundResult.ok) return sendJson(response, 422, { error: 'invalid scene background', reasons: backgroundResult.reasons });
    const scene = {
      ...defaultScene,
      ...body,
      id: 'scene_' + randomUUID(),
      width: sceneWidth,
      height: sceneHeight,
      unit: sceneUnit,
      background: backgroundResult.background,
      regions: regionResult.regions,
      portals: portalResult.portals,
      sources: Array.isArray(body.sources) ? body.sources.map((source) => withSourceProfileDigest(source)) : [],
      placements: Array.isArray(body.placements) ? body.placements : []
    };
    await store.upsertScene(scene);
    return sendJson(response, 201, activateScene(scene));
  }
  if (parts[0] === 'api' && parts[1] === 'scenes' && parts[2]) {
    const sceneId = parts[2];
    const scene = store.getScene(sceneId);
    if (!scene) return sendJson(response, 404, { error: 'scene not found' });
    if (request.method === 'POST' && parts[3] === 'activate' && parts.length === 4) {
      if (recordingSessionId) return sendJson(response, 409, { error: 'stop the active recording before switching scenes' });
      return sendJson(response, 200, { scene: activateScene(scene) });
    }
    if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, scene);
    if (request.method === 'PATCH' && parts.length === 3) {
      const body = await bodyJson(request);
      const updated = { ...scene, ...body, id: scene.id };
      if (body.unit !== undefined && !SCENE_UNITS.includes(body.unit)) {
        return sendJson(response, 422, { error: 'unsupported scene unit' });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'regions')) {
        const regionResult = validateRegions(body.regions, { width: updated.width, height: updated.height });
        if (!regionResult.ok) return sendJson(response, 422, { error: 'invalid scene regions', reasons: regionResult.reasons });
        updated.regions = regionResult.regions;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'portals')) {
        const portalResult = validatePortals(body.portals, { width: updated.width, height: updated.height });
        if (!portalResult.ok) return sendJson(response, 422, { error: 'invalid scene portals', reasons: portalResult.reasons });
        updated.portals = portalResult.portals;
      }
      const backgroundResult = validateBackground(updated.background, { width: updated.width, height: updated.height });
      if (!backgroundResult.ok) return sendJson(response, 422, { error: 'invalid scene background', reasons: backgroundResult.reasons });
      updated.background = backgroundResult.background;
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SceneRevisionPublished', {
        sceneId: updated.id,
        fields: Object.keys(body).sort().slice(0, 32),
        sourceCount: updated.sources?.length || 0,
        width: updated.width,
        height: updated.height
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 200, updated);
    }
    if (request.method === 'POST' && parts[3] === 'regions' && parts.length === 4) {
      const body = await bodyJson(request);
      const result = validateRegion(body, { width: scene.width, height: scene.height });
      if (!result.ok) return sendJson(response, 422, { error: 'invalid scene region', reasons: result.reasons });
      const region = { ...result.region, id: 'region_' + randomUUID(), createdAtMs: Date.now() };
      const updated = { ...scene, regions: [...(scene.regions || []), region] };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SceneRevisionPublished', {
        sceneId: updated.id,
        fields: ['regions'],
        regionId: region.id,
        regionKind: region.kind,
        regionCount: updated.regions.length
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 201, region);
    }
    if (request.method === 'DELETE' && parts[3] === 'regions' && parts[4]) {
      const regionId = parts[4];
      if (!(scene.regions || []).some((region) => region.id === regionId)) {
        return sendJson(response, 404, { error: 'region not found' });
      }
      const updated = { ...scene, regions: scene.regions.filter((region) => region.id !== regionId) };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SceneRevisionPublished', {
        sceneId: updated.id,
        fields: ['regions'],
        removedRegionId: regionId,
        regionCount: updated.regions.length
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 200, { regionId, removed: true });
    }
    if (request.method === 'POST' && parts[3] === 'portals' && parts.length === 4) {
      const body = await bodyJson(request);
      const result = validatePortal(body, { width: scene.width, height: scene.height });
      if (!result.ok) return sendJson(response, 422, { error: 'invalid scene portal', reasons: result.reasons });
      const portal = { ...result.portal, id: 'portal_' + randomUUID(), createdAtMs: Date.now() };
      const updated = { ...scene, portals: [...(scene.portals || []), portal] };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SceneRevisionPublished', {
        sceneId: updated.id,
        fields: ['portals'],
        portalId: portal.id,
        portalKind: portal.kind,
        portalCount: updated.portals.length
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 201, portal);
    }
    if (request.method === 'DELETE' && parts[3] === 'portals' && parts[4]) {
      const portalId = parts[4];
      if (!(scene.portals || []).some((portal) => portal.id === portalId)) {
        return sendJson(response, 404, { error: 'portal not found' });
      }
      const updated = { ...scene, portals: scene.portals.filter((portal) => portal.id !== portalId) };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SceneRevisionPublished', {
        sceneId: updated.id,
        fields: ['portals'],
        removedPortalId: portalId,
        portalCount: updated.portals.length
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 200, { portalId, removed: true });
    }
    if (request.method === 'POST' && parts[3] === 'sources') {
      const body = await bodyJson(request);
      const sourceId = body.id || 'source_' + randomUUID();
      const manifestResult = validateProviderManifest(body.providerManifest || {
        protocolVersion: 'sidechannel.adapter/1',
        providerId: 'local:' + sourceId,
        providerVersion: '0.1.0',
        capabilities: body.capabilities?.length ? body.capabilities : ['normalized_observation'],
        supportedUnits: body.unit ? [body.unit] : [],
        rawContentPolicy: 'none'
      });
      if (!manifestResult.ok) return sendJson(response, 422, { error: 'invalid provider manifest', reasons: manifestResult.reasons });
      adapterSupervisor.register(manifestResult.manifest);
      const source = {
        ...body,
        id: sourceId,
        name: body.name || 'Local source',
        adapterType: body.adapterType || 'manual',
        channels: body.channels || [],
        capabilities: body.capabilities || [],
        freshnessWindowMs: body.freshnessWindowMs || 2000,
        privacyMode: body.privacyMode || 'local_numeric',
        spatialPolicy: body.spatialPolicy || 'scene_position',
        ...(Number.isFinite(body.poseMaxAgeMs) ? { poseMaxAgeMs: body.poseMaxAgeMs } : {}),
        ...(typeof body.poseFrameId === 'string' ? { poseFrameId: body.poseFrameId } : {}),
        connected: false,
        position: body.position || { x: scene.width / 2, y: scene.height / 2, uncertaintyRadius: 0.5 },
        calibrationState: body.calibrationState || 'uncalibrated',
        providerManifest: manifestResult.manifest
      };
      const persistedSource = withSourceProfileDigest(source);
      const updated = { ...scene, sources: [...scene.sources, persistedSource] };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SourceRevisionPublished', {
        sceneId: updated.id,
        sourceId: persistedSource.id,
        created: true,
        source: sourceRevisionPayload(persistedSource)
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 201, persistedSource);
    }
    if (request.method === 'PATCH' && parts[3] === 'sources' && parts[4]) {
      const sourceId = parts[4];
      const existing = scene.sources.find((source) => source.id === sourceId);
      if (!existing) return sendJson(response, 404, { error: 'source not found' });
      const body = await bodyJson(request);
      const source = {
        ...existing,
        ...body,
        id: existing.id,
        position: body.position ? {
          x: Number(body.position.x),
          y: Number(body.position.y),
          ...(body.position.z === undefined ? {} : { z: Number(body.position.z) }),
          ...(body.position.uncertaintyRadius === undefined
            ? {}
            : { uncertaintyRadius: Number(body.position.uncertaintyRadius) })
        } : existing.position,
        calibrationState: body.calibrationState || 'calibrated',
        calibratedAtMs: body.calibratedAtMs || Date.now()
      };
      source.sourceProfileDigest = computeSourceProfileDigest(source);
      const updated = {
        ...scene,
        sources: scene.sources.map((item) => item.id === sourceId ? source : item),
        placements: scene.placements.map((placement) => placement.sourceId === sourceId
          ? { ...placement, position: source.position, calibrationState: source.calibrationState, calibratedAtMs: source.calibratedAtMs }
          : placement)
      };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      appendRuntimeEvent('SourceRevisionPublished', {
        sceneId: updated.id,
        sourceId: source.id,
        created: false,
        source: sourceRevisionPayload(source)
      });
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 200, source);
    }
  }
  if (request.method === 'POST' && pathname === '/api/observations') {
    const body = await bodyJson(request);
    const result = await ingest(body);
    return sendJson(response, result.ok ? 202 : 422, result);
  }
  if (request.method === 'GET' && pathname === '/api/sessions') {
    return sendJson(response, 200, { sessions: store.listSessions() });
  }
  if (request.method === 'POST' && pathname === '/api/sessions') {
    if (recordingSessionId) await store.finishSession(recordingSessionId);
    const body = await bodyJson(request);
    const scene = store.getScene(body.sceneId || activeScene.id) || activeScene;
    const session = await store.createSession(scene.id, {
      scene,
      sources: scene.sources,
      calibrations: calibrationRegistry.list(),
      transformGraph: transformGraph.snapshot()
    });
    recordingSessionId = session.id;
    broadcast({ type: 'session.state', state: 'recording', id: session.id });
    return sendJson(response, 201, { session });
  }
  if (request.method === 'POST' && pathname === '/api/evaluation/cooccurrence') {
    const body = await bodyJson(request);
    const session = body.sessionId ? store.getSession(body.sessionId) : null;
    if (body.sessionId && !session) return sendJson(response, 404, { error: 'co-occurrence session not found' });
    try {
      const artifact = createCoOccurrenceArtifact({
        observations: session ? session.observations : currentObservations(),
        sources: session ? session.sourceRegistrySnapshot : activeScene.sources,
        channels: body.channels || [body.channelA, body.channelB].filter(Boolean),
        startMs: body.startMs,
        endMs: body.endMs,
        bucketMs: body.bucketMs === undefined ? 1000 : Number(body.bucketMs),
        changeThreshold: body.changeThreshold === undefined ? .1 : Number(body.changeThreshold),
        maxLagMs: body.maxLagMs === undefined ? 0 : Number(body.maxLagMs),
        region: body.region,
        sourceSessionId: session?.id || null
      });
      return sendJson(response, 200, { artifact });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/evaluation/adaptive-field') {
    const body = await bodyJson(request);
    const session = body.sessionId ? store.getSession(body.sessionId) : null;
    if (body.sessionId && !session) return sendJson(response, 404, { error: 'adaptive field session not found' });
    try {
      const field = interpolateAdaptiveActivityField({
        scene: session?.sceneSnapshot || activeScene,
        observations: session?.observations || currentObservations(),
        sources: session?.sourceRegistrySnapshot || activeScene.sources,
        weights: body.weights || {},
        baseGrid: body.baseGrid === undefined ? 4 : Number(body.baseGrid),
        maxDepth: body.maxDepth === undefined ? 2 : Number(body.maxDepth),
        maxTiles: body.maxTiles === undefined ? 512 : Number(body.maxTiles),
        refineThreshold: body.refineThreshold === undefined ? .12 : Number(body.refineThreshold),
        power: body.power === undefined ? 2 : Number(body.power),
        sourceSessionId: session?.id || null
      });
      return sendJson(response, 200, { field });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/verification/faults') {
    const body = await bodyJson(request);
    try {
      const receipt = await runFaultCampaign({
        runId: typeof body.runId === 'string' && body.runId.length ? body.runId : 'faults_' + Date.now(),
        sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
      });
      return sendJson(response, 200, { receipt, verification: verifyFaultCampaignReceipt(receipt) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/sessions/compare') {
    const body = await bodyJson(request);
    const leftSession = store.getSession(body.leftSessionId);
    const rightSession = store.getSession(body.rightSessionId);
    if (!leftSession || !rightSession) return sendJson(response, 404, { error: 'comparison session not found' });
    try {
      const options = {
        estimatorVersion: body.estimatorVersion || 'activity-field/1',
        gridSize: Number(body.gridSize || 28),
        power: Number(body.power || 2),
        weights: body.weights || {}
      };
      const comparison = compareRecomputedArtifacts(
        recomputeSession(leftSession, options),
        recomputeSession(rightSession, options)
      );
      return sendJson(response, 200, { comparison });
    } catch (error) {
      return sendJson(response, error.code === 'INCOMPLETE_SNAPSHOT' ? 409 : 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/sessions/compare-time') {
    const body = await bodyJson(request);
    const session = store.getSession(body.sessionId);
    const leftTimeMs = Number(body.leftTimeMs);
    const rightTimeMs = Number(body.rightTimeMs);
    if (!session) return sendJson(response, 404, { error: 'temporal comparison session not found' });
    if (!Number.isFinite(leftTimeMs) || !Number.isFinite(rightTimeMs)) {
      return sendJson(response, 422, { error: 'temporal comparison requires two finite timestamps' });
    }
    try {
      const options = {
        estimatorVersion: body.estimatorVersion || 'activity-field/1',
        gridSize: Number(body.gridSize || 28),
        power: Number(body.power || 2),
        weights: body.weights || {}
      };
      const comparison = compareRecomputedArtifacts(
        recomputeSession(session, { ...options, atTimeMs: leftTimeMs }),
        recomputeSession(session, { ...options, atTimeMs: rightTimeMs }),
        { comparisonKind: 'within-session-temporal' }
      );
      return sendJson(response, 200, { comparison });
    } catch (error) {
      return sendJson(response, error.code === 'INCOMPLETE_SNAPSHOT' ? 409 : 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'stop') {
    const session = await store.finishSession(parts[2]);
    if (recordingSessionId === parts[2]) recordingSessionId = null;
    broadcast({ type: 'session.state', state: 'idle', id: parts[2] });
    return sendJson(response, session ? 200 : 404, { session });
  }
  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'export') {
    const session = store.getSession(parts[2]);
    if (!session) return sendJson(response, 404, { error: 'session not found' });
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="' + parts[2] + '.json"'
    });
    return response.end(JSON.stringify(sessionPackage(session), null, 2));
  }
  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'export') {
    const session = store.getSession(parts[2]);
    if (!session) return sendJson(response, 404, { error: 'session not found' });
    const body = await bodyJson(request);
    try {
      return sendJson(response, 200, encryptSessionPackage(sessionPackage(session), body.passphrase));
    } catch (error) {
      return sendJson(response, 422, { error: error.message, code: error.code || 'ENCRYPTION_FAILED' });
    }
  }
  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'verify') {
    const session = store.getSession(parts[2]);
    if (!session) return sendJson(response, 404, { error: 'session not found' });
    return sendJson(response, 200, verifySessionPackage(sessionPackage(session)));
  }
  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'replay') {
    const session = store.getSession(parts[2]);
    if (!session) return sendJson(response, 404, { error: 'session not found' });
    const mode = new URL(request.url, 'http://127.0.0.1').searchParams.get('mode') || 'historical';
    try {
      if (mode === 'historical') return sendJson(response, 200, { replay: createHistoricalReplay(session) });
      if (mode === 'recompute') return sendJson(response, 200, { replay: recomputeSession(session) });
      if (mode === 'determinism') return sendJson(response, 200, { report: verifyDeterminism(session) });
      return sendJson(response, 400, { error: 'unsupported replay mode' });
    } catch (error) {
      return sendJson(response, error.code === 'INCOMPLETE_SNAPSHOT' ? 409 : 422, { error: error.message });
    }
  }
  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'receipt') {
    const session = store.getSession(parts[2]);
    if (!session) return sendJson(response, 404, { error: 'session not found' });
    try {
      return sendJson(response, 200, {
        receipt: createReplayReceipt(session, {
          sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
        })
      });
    } catch (error) {
      return sendJson(response, error.code === 'INCOMPLETE_SNAPSHOT' ? 409 : 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && pathname === '/api/sessions/import') {
    const body = await bodyJson(request);
    let packageData = body;
    if (body?.encryptedPackage || body?.format === 'sidechannel-encrypted-session') {
      const envelope = body.encryptedPackage || body;
      try {
        packageData = decryptSessionPackage(envelope, body.passphrase);
      } catch (error) {
        return sendJson(response, 422, { error: error.message, code: error.code || 'DECRYPTION_FAILED' });
      }
    }
    const verification = verifySessionPackage(packageData);
    if (!verification.ok) {
      return sendJson(response, 422, {
        error: 'session package failed independent verification',
        verification
      });
    }
    const session = await store.importPackage(packageData);
    return sendJson(response, 201, { session });
  }
  if (parts[0] === 'api' && parts[1] === 'sessions' && parts[2]) {
    if (request.method === 'GET') {
      const session = store.getSession(parts[2]);
      return sendJson(response, session ? 200 : 404, session ? { session } : { error: 'session not found' });
    }
    if (request.method === 'DELETE') {
      const deleted = await store.deleteSession(parts[2]);
      return sendJson(response, deleted ? 200 : 404, { deleted });
    }
  }
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(publicDir, '.' + requested);
  if (!filePath.startsWith(publicDir)) return sendText(response, 403, 'forbidden');
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) return sendText(response, 404, 'not found');
    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    createReadStream(filePath).pipe(response);
  } catch {
    return sendText(response, 404, 'not found');
  }
}

function handleWebSocketControls(socket, parsed) {
  for (const frame of parsed.controlFrames || []) {
    socket.write(encodeControlFrame(frame.opcode, frame.payload));
  }
  if (parsed.closeRequested) {
    socket.end();
    return true;
  }
  if (parsed.protocolError) {
    socket.end(encodeCloseFrame(1002, parsed.protocolError));
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  try {
    if (!isAllowedLoopbackHost(request.headers.host, port)) {
      return sendJson(response, 400, { error: 'invalid local Host header' });
    }
    if (!isAllowedOrigin(request.headers.origin, port)) {
      return sendJson(response, 403, { error: 'invalid local Origin header' });
    }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
        !hasValidLaunchToken(request.headers['x-sidechannel-launch-token'], launchToken)) {
      return sendJson(response, 403, { error: 'missing or invalid local launch token' });
    }
    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(request, response, pathname);
      if (handled !== false) return;
    }
    await serveStatic(request, response, pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.on('upgrade', (request, socket) => {
  const parsedUrl = new URL(request.url, 'http://127.0.0.1');
  const pathname = parsedUrl.pathname;
  if (!isAllowedLoopbackHost(request.headers.host, port) || !isAllowedOrigin(request.headers.origin, port)) {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/live' && pathname !== '/ws/ingest') {
    socket.destroy();
    return;
  }
  if (pathname === '/ws/ingest' && !hasValidLaunchToken(parsedUrl.searchParams.get('token'), launchToken)) {
    socket.destroy();
    return;
  }
  const key = request.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  if (pathname === '/ws/live' && clients.size >= MAX_LIVE_CLIENTS) {
    socket.destroy();
    return;
  }
  if (pathname === '/ws/ingest' && ingestClients.size >= MAX_INGEST_CLIENTS) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  if (pathname === '/ws/ingest') {
    ingestClients.add(socket);
    let incoming = Buffer.alloc(0);
    const rateLimiter = createRateLimiter({ limit: 1000, windowMs: 1000 });
    socket.on('data', (chunk) => {
      if (!rateLimiter.allow()) {
        socket.destroy();
        return;
      }
      incoming = Buffer.concat([incoming, chunk]);
      if (incoming.length > MAX_WEBSOCKET_BUFFER_BYTES) {
        socket.destroy();
        return;
      }
      const parsed = consumeTextFrames(incoming);
      incoming = parsed.remainder;
      if (handleWebSocketControls(socket, parsed)) return;
      parsed.messages.forEach((message) => {
        if (message === JSON.stringify({ type: 'ping' })) return;
        try {
          const raw = JSON.parse(message);
          ingest(raw).then((result) => {
            socket.write(encodeTextFrame({
              type: 'ingest.result',
              ok: result.ok,
              id: result.observation?.id || result.diagnostic?.id,
              reasons: result.diagnostic?.reasons || []
            }));
          });
        } catch (error) {
          socket.write(encodeTextFrame({
            type: 'ingest.result',
            ok: false,
            reasons: [{ id: 'json', message: error.message }]
          }));
        }
      });
    });
    socket.on('close', () => ingestClients.delete(socket));
    socket.on('error', () => {
      ingestClients.delete(socket);
      socket.destroy();
    });
    return;
  }
  clients.add(socket);
  socket.write(encodeTextFrame({ type: 'snapshot', state: snapshot() }));
  let incoming = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);
    if (incoming.length > MAX_WEBSOCKET_BUFFER_BYTES) {
      socket.end(encodeCloseFrame(1009, 'frame buffer exceeds maximum size'));
      return;
    }
    const parsed = consumeTextFrames(incoming);
    incoming = parsed.remainder;
    if (handleWebSocketControls(socket, parsed)) return;
    if (parsed.messages.length > 0) socket.end(encodeCloseFrame(1003, 'live channel is server-push only'));
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

activateScene(activeScene);
adapterSupervisor.start('builtin:simulator');

server.listen(port, '127.0.0.1', () => {
  console.log('SIDECHANNEL listening on http://127.0.0.1:' + port);
});

process.on('SIGINT', () => {
  simulator.stop();
  adapterSupervisor.stop('builtin:simulator');
  server.close(() => {
    store.close();
    process.exit(0);
  });
});

export { server, simulator, snapshot, ingest };
