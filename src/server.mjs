import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFreshness, validateObservation } from './validation.mjs';
import { createDefaultScene, createSimulator } from './simulator.mjs';
import { SqliteStore } from './sqlite-store.mjs';
import { consumeTextFrames, encodeTextFrame } from './websocket.mjs';
import { listAdapters } from './adapters/registry.mjs';
import { createEventDetector } from './events.mjs';
import { createIngressSequencer } from './admission/sequencer.mjs';
import { createProviderManifest, validateProviderManifest } from './admission/manifest.mjs';
import { CalibrationRegistry } from './calibration/registry.mjs';
import { TransformGraph } from './spatial/transform-graph.mjs';
import { verifySessionPackage } from './session-verifier.mjs';
import { createRateLimiter, isAllowedLoopbackHost, isAllowedOrigin } from './security.mjs';
import { AdapterSupervisor } from './adapters/supervisor.mjs';
import { compareRecomputedArtifacts, createHistoricalReplay, recomputeSession, verifyDeterminism } from './replay.mjs';
import { createReplayReceipt } from './verification/receipt.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const dataFile = join(root, 'data', 'sidechannel.sqlite');
const legacyDataFile = join(root, 'data', 'sidechannel.json');
const port = Number(process.env.PORT || 4173);
const store = new SqliteStore(dataFile, { legacyJsonPath: legacyDataFile });
const defaultScene = createDefaultScene();

await store.init(defaultScene);

let activeScene = store.getScene(defaultScene.id) || defaultScene;
let recordingSessionId = null;
const latest = new Map();
const diagnostics = [];
const recentEvents = [];
const clients = new Set();
const eventDetector = createEventDetector();
const calibrationRegistry = new CalibrationRegistry();
const transformGraph = new TransformGraph();
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
  return new Map(activeScene.sources.map((source) => [source.id, source]));
}

function currentObservations() {
  const sources = sourceMap();
  return Array.from(latest.values()).map((observation) =>
    applyFreshness(observation, sources.get(observation.sourceId), Date.now())
  );
}

function snapshot() {
  return {
    scene: activeScene,
    observations: currentObservations(),
    events: recentEvents.slice(-40),
    diagnostics: diagnostics.slice(-40),
    calibrations: calibrationRegistry.list(),
    transforms: transformGraph.snapshot(),
    adapterRuntime: adapterSupervisor.list(),
    recording: recordingSessionId
      ? { id: recordingSessionId, state: 'recording' }
      : null,
    sessions: store.listSessions(),
    server: {
      nowMs: Date.now(),
      loopbackOnly: true,
      simulator: true
    }
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
  broadcast(diagnostic);
  return { ok: false, diagnostic };
}

async function processObservation(raw) {
  const result = validateObservation(raw, { sources: sourceMap() });
  if (!result.ok) {
    return recordDiagnostic({
      type: 'observation.rejected',
      id: result.id,
      reasons: result.reasons,
      receivedAtMs: Date.now()
    });
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
  const observation = { ...result.observation, sequence: ++admissionSequence };
  latest.set(observation.sourceId + ':' + observation.channel, observation);
  if (recordingSessionId) await store.appendObservation(recordingSessionId, observation);
  broadcast({ type: 'observation.accepted', observation });
  const event = eventDetector.observe(observation, sourceMap().get(observation.sourceId));
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
  return {
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
}

async function handleApi(request, response, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (request.method === 'GET' && pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true,
      service: 'sidechannel',
      loopbackOnly: true,
      simulator: true,
      nowMs: Date.now()
    });
  }
  if (request.method === 'GET' && pathname === '/api/state') {
    return sendJson(response, 200, snapshot());
  }
  if (request.method === 'GET' && pathname === '/api/adapters') {
    return sendJson(response, 200, { adapters: listAdapters() });
  }
  if (request.method === 'GET' && pathname === '/api/adapter-runtime') {
    return sendJson(response, 200, { adapters: adapterSupervisor.list() });
  }
  if (request.method === 'GET' && pathname === '/api/calibrations') {
    return sendJson(response, 200, { revision: calibrationRegistry.revision, calibrations: calibrationRegistry.list() });
  }
  if (request.method === 'POST' && pathname === '/api/calibrations') {
    const body = await bodyJson(request);
    try {
      const calibration = calibrationRegistry.publish(body);
      return sendJson(response, 201, calibration);
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'GET' && pathname === '/api/transforms') {
    return sendJson(response, 200, transformGraph.snapshot());
  }
  if (request.method === 'POST' && pathname === '/api/transforms') {
    const body = await bodyJson(request);
    try {
      return sendJson(response, 201, transformGraph.publish(body));
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }
  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'calibrations' && parts[2] && parts[3] === 'invalidate') {
    const body = await bodyJson(request);
    const calibration = calibrationRegistry.invalidate(parts[2], body.reason || 'operator invalidation');
    return sendJson(response, calibration ? 200 : 404, calibration || { error: 'calibration not found' });
  }
  if (request.method === 'GET' && pathname === '/api/scenes') {
    return sendJson(response, 200, { scenes: store.listScenes() });
  }
  if (request.method === 'POST' && pathname === '/api/scenes') {
    const body = await bodyJson(request);
    const scene = {
      ...defaultScene,
      ...body,
      id: 'scene_' + randomUUID(),
      sources: Array.isArray(body.sources) ? body.sources : [],
      placements: Array.isArray(body.placements) ? body.placements : []
    };
    await store.upsertScene(scene);
    activeScene = scene;
    broadcast({ type: 'scene.updated', scene });
    return sendJson(response, 201, scene);
  }
  if (parts[0] === 'api' && parts[1] === 'scenes' && parts[2]) {
    const sceneId = parts[2];
    const scene = store.getScene(sceneId);
    if (!scene) return sendJson(response, 404, { error: 'scene not found' });
    if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, scene);
    if (request.method === 'PATCH' && parts.length === 3) {
      const body = await bodyJson(request);
      const updated = { ...scene, ...body, id: scene.id };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 200, updated);
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
        connected: false,
        position: body.position || { x: scene.width / 2, y: scene.height / 2, uncertaintyRadius: 0.5 },
        calibrationState: body.calibrationState || 'uncalibrated',
        providerManifest: manifestResult.manifest
      };
      const updated = { ...scene, sources: [...scene.sources, source] };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
      broadcast({ type: 'scene.updated', scene: updated });
      return sendJson(response, 201, source);
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
      const updated = {
        ...scene,
        sources: scene.sources.map((item) => item.id === sourceId ? source : item),
        placements: scene.placements.map((placement) => placement.sourceId === sourceId
          ? { ...placement, position: source.position, calibrationState: source.calibrationState, calibratedAtMs: source.calibratedAtMs }
          : placement)
      };
      await store.upsertScene(updated);
      if (activeScene.id === updated.id) activeScene = updated;
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
    const session = await store.importPackage(body);
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

const server = createServer(async (request, response) => {
  try {
    if (!isAllowedLoopbackHost(request.headers.host, port)) {
      return sendJson(response, 400, { error: 'invalid local Host header' });
    }
    if (!isAllowedOrigin(request.headers.origin, port)) {
      return sendJson(response, 403, { error: 'invalid local Origin header' });
    }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
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
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!isAllowedLoopbackHost(request.headers.host, port) || !isAllowedOrigin(request.headers.origin, port)) {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/live' && pathname !== '/ws/ingest') {
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
      if (parsed.protocolError) {
        socket.destroy();
        return;
      }
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
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

const simulator = createSimulator({
  sources: activeScene.sources.filter((source) => source.adapterType === 'simulator'),
  emit: (observation) => {
    ingest(observation).catch((error) => diagnostics.push({
      type: 'simulator.error',
      message: error.message,
      receivedAtMs: Date.now()
    }));
  }
});
adapterSupervisor.start('builtin:simulator');
simulator.start();

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
