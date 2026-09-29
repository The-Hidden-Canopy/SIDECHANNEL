import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFreshness, validateObservation } from './validation.mjs';
import { createDefaultScene, createSimulator } from './simulator.mjs';
import { JsonStore } from './store.mjs';
import { consumeTextFrames, encodeTextFrame } from './websocket.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const dataFile = join(root, 'data', 'sidechannel.json');
const port = Number(process.env.PORT || 4173);
const store = new JsonStore(dataFile);
const defaultScene = createDefaultScene();

await store.init(defaultScene);

let activeScene = store.getScene(defaultScene.id) || defaultScene;
let recordingSessionId = null;
const latest = new Map();
const diagnostics = [];
const clients = new Set();

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
    diagnostics: diagnostics.slice(-40),
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

async function ingest(raw) {
  const result = validateObservation(raw, { sources: sourceMap() });
  if (!result.ok) {
    const diagnostic = {
      type: 'observation.rejected',
      id: result.id,
      reasons: result.reasons,
      receivedAtMs: Date.now()
    };
    diagnostics.push(diagnostic);
    broadcast(diagnostic);
    return { ok: false, diagnostic };
  }

  const observation = result.observation;
  latest.set(observation.sourceId + ':' + observation.channel, observation);
  if (recordingSessionId) await store.appendObservation(recordingSessionId, observation);
  broadcast({ type: 'observation.accepted', observation });
  return { ok: true, observation };
}

function sessionPackage(session) {
  return {
    format: 'sidechannel-session',
    formatVersion: '0.1',
    scene: activeScene,
    sources: activeScene.sources,
    observations: session.observations,
    events: session.events,
    createdAtMs: session.startedAtMs,
    privacy: {
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
      const source = {
        id: body.id || 'source_' + randomUUID(),
        name: body.name || 'Local source',
        adapterType: body.adapterType || 'manual',
        channels: body.channels || [],
        capabilities: body.capabilities || [],
        freshnessWindowMs: body.freshnessWindowMs || 2000,
        privacyMode: body.privacyMode || 'local_numeric',
        connected: false,
        ...body
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
    const session = await store.createSession(body.sceneId || activeScene.id);
    recordingSessionId = session.id;
    broadcast({ type: 'session.state', state: 'recording', id: session.id });
    return sendJson(response, 201, { session });
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
  if (pathname !== '/ws/live' && pathname !== '/ws/ingest') {
    socket.destroy();
    return;
  }
  const key = request.headers['sec-websocket-key'];
  if (!key) {
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
    let incoming = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      incoming = Buffer.concat([incoming, chunk]);
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
    socket.on('error', () => socket.destroy());
    return;
  }
  clients.add(socket);
  socket.write(encodeTextFrame({ type: 'snapshot', state: snapshot() }));
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

const simulator = createSimulator({
  sources: activeScene.sources,
  emit: (observation) => {
    ingest(observation).catch((error) => diagnostics.push({
      type: 'simulator.error',
      message: error.message,
      receivedAtMs: Date.now()
    }));
  }
});
simulator.start();

server.listen(port, '127.0.0.1', () => {
  console.log('SIDECHANNEL listening on http://127.0.0.1:' + port);
});

process.on('SIGINT', () => {
  simulator.stop();
  server.close(() => process.exit(0));
});

export { server, simulator, snapshot, ingest };
