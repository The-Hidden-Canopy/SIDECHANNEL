import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = join(import.meta.dirname, '..');

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function openWebSocket(port, path) {
  const socket = createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  let buffer = Buffer.alloc(0);
  let failure = null;
  const waiters = [];
  const rejectWaiters = (error) => {
    failure = failure || error;
    while (waiters.length) waiters.shift().reject(failure);
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (waiters.length) waiters.shift().resolve();
  });
  socket.on('error', rejectWaiters);
  socket.on('close', () => rejectWaiters(new Error('websocket closed before a frame was received')));
  const waitForData = () => {
    if (buffer.length) return Promise.resolve();
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
  const key = Buffer.from('sidechannel-smoke-key').toString('base64');
  socket.write(
    'GET ' + path + ' HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + port + '\r\n' +
    'Origin: http://127.0.0.1:' + port + '\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Version: 13\r\n' +
    'Sec-WebSocket-Key: ' + key + '\r\n\r\n'
  );
  while (!buffer.includes(Buffer.from('\r\n\r\n'))) await waitForData();
  const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n')) + 4;
  assert.match(buffer.subarray(0, headerEnd).toString('utf8'), /^HTTP\/1\.1 101 Switching Protocols/m);
  buffer = buffer.subarray(headerEnd);
  return {
    socket,
    async nextFrame() {
      while (true) {
        if (buffer.length < 2) {
          await waitForData();
          continue;
        }
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) {
            await waitForData();
            continue;
          }
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) {
            await waitForData();
            continue;
          }
          const extendedLength = buffer.readBigUInt64BE(2);
          if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('websocket frame too large for smoke reader');
          length = Number(extendedLength);
          offset = 10;
        }
        if (masked) throw new Error('server websocket frame was unexpectedly masked');
        if (buffer.length < offset + length) {
          await waitForData();
          continue;
        }
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        if (opcode === 0x1) return JSON.parse(payload.toString('utf8'));
        if (opcode === 0x8) throw new Error('websocket closed before expected live event');
      }
    }
  };
}

async function openLiveSocket(port) {
  return openWebSocket(port, '/ws/live');
}

async function openIngestSocket(port, launchToken) {
  return openWebSocket(port, '/ws/ingest?token=' + encodeURIComponent(launchToken));
}

function maskedTextFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const mask = Buffer.from([0x53, 0x49, 0x44, 0x45]);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    throw new Error('smoke websocket payload exceeds bounded test frame');
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % mask.length];
  return Buffer.concat([header, mask, masked]);
}

async function withTimeout(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(baseUrl, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('server exited before health: ' + stderr.join(''));
    try {
      const result = await requestJson(baseUrl + '/api/health');
      if (result.response.ok) return result.payload;
    } catch {
      // The process may still be binding its loopback listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server health did not become ready: ' + stderr.join(''));
}

test('loopback server smoke covers live websocket reconnect, adapter ingress, session export/import/replay/delete, and verification', async () => {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'sidechannel-smoke-'));
  const stderr = [];
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SIDECHANNEL_DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const baseUrl = 'http://127.0.0.1:' + port;
  let liveSocket = null;
  let reconnectSocket = null;
  let ingestSocket = null;
  try {
    const health = await waitForHealth(baseUrl, child, stderr);
    assert.equal(health.loopbackOnly, true);
    assert.equal(typeof health.launchToken, 'string');

    const sceneView = await requestJson(baseUrl + '/api/scene-view');
    assert.equal(sceneView.response.status, 200);
    assert.equal(sceneView.payload.format, 'sidechannel.scene-view/1');
    assert.ok(Array.isArray(sceneView.payload.sourceProjections));
    assert.ok(sceneView.payload.sourceProjections.some((source) => source.health === 'live'));
    const sceneViewBenchmark = await requestJson(baseUrl + '/api/benchmark/scene-view', {
      method: 'POST',
      headers: { 'x-sidechannel-launch-token': health.launchToken, 'content-type': 'application/json' },
      body: JSON.stringify({ iterations: 2, sourceCount: 8, seed: 1337 })
    });
    assert.equal(sceneViewBenchmark.response.status, 200);
    assert.equal(sceneViewBenchmark.payload.verification.ok, true);
    assert.equal(sceneViewBenchmark.payload.receipt.sceneViewFormat, 'sidechannel.scene-view/1');

    const posture = await requestJson(baseUrl + '/api/security-posture');
    assert.equal(posture.response.status, 200);
    assert.equal(posture.payload.format, 'sidechannel-security-posture');
    assert.ok(posture.payload.claims.some((claim) => claim.id === 'privacy-admission' && claim.status === 'enforced'));
    assert.ok(posture.payload.claims.some((claim) => claim.id === 'deployment-hardening' && claim.status === 'external-gate'));

    const live = await withTimeout(openLiveSocket(port), 3000, 'live websocket handshake');
    liveSocket = live.socket;
    const initialSnapshot = await withTimeout(live.nextFrame(), 3000, 'initial live snapshot');
    assert.equal(initialSnapshot.type, 'snapshot');
    assert.equal(initialSnapshot.state.server.loopbackOnly, true);
    let accepted = null;
    for (let attempt = 0; attempt < 12 && !accepted; attempt += 1) {
      const event = await withTimeout(live.nextFrame(), 1000, 'simulator live event');
      if (event.type === 'observation.accepted') accepted = event;
    }
    assert.ok(accepted?.observation?.sourceId, 'simulator observation was not broadcast over /ws/live');
    liveSocket.destroy();
    liveSocket = null;

    let reconnect = await withTimeout(openLiveSocket(port), 3000, 'live websocket reconnect');
    reconnectSocket = reconnect.socket;
    const reconnectSnapshot = await withTimeout(reconnect.nextFrame(), 3000, 'reconnect snapshot');
    assert.equal(reconnectSnapshot.type, 'snapshot');
    assert.equal(reconnectSnapshot.state.server.loopbackOnly, true);

    const simulatorStopped = await requestJson(baseUrl + '/api/adapter-runtime/' + encodeURIComponent('builtin:simulator') + '/stop', {
      method: 'POST',
      headers: { 'x-sidechannel-launch-token': health.launchToken }
    });
    assert.equal(simulatorStopped.response.status, 200);
    assert.equal(simulatorStopped.payload.adapter.state, 'STOPPED');
    const stoppedRuntime = await requestJson(baseUrl + '/api/adapter-runtime');
    assert.equal(stoppedRuntime.payload.adapters.find((adapter) => adapter.manifest.providerId === 'builtin:simulator').state, 'STOPPED');
    let ingressDrained = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ingressState = await requestJson(baseUrl + '/api/ingress');
      const receipt = ingressState.payload.receipt;
      if (receipt.pending === 0 && receipt.busy === false) {
        ingressDrained = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(ingressDrained, true, 'bounded ingress queue did not drain after simulator stop');
    reconnectSocket.destroy();
    reconnectSocket = null;
    reconnect = await withTimeout(openLiveSocket(port), 3000, 'post-drain live websocket reconnect');
    reconnectSocket = reconnect.socket;
    const postDrainSnapshot = await withTimeout(reconnect.nextFrame(), 3000, 'post-drain snapshot');
    assert.equal(postDrainSnapshot.type, 'snapshot');

    const renderBudgetAsset = await fetch(baseUrl + '/render-budget.mjs');
    assert.equal(renderBudgetAsset.status, 200);
    assert.match(renderBudgetAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await renderBudgetAsset.text(), /renderBudgetForObservationCount/);

    const sourceBody = JSON.stringify({
      id: 'smoke_source',
      name: 'Smoke source',
      adapterType: 'manual',
      channels: ['heat'],
      capabilities: ['manual_observation'],
      unit: 'C',
      range: [0, 100],
      freshnessWindowMs: 2000,
      privacyMode: 'summary_only'
    });
    const sourcePath = baseUrl + '/api/scenes/scene_main/sources';
    const unauthorized = await requestJson(sourcePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sourceBody
    });
    assert.equal(unauthorized.response.status, 403);

    const headers = {
      'content-type': 'application/json',
      'x-sidechannel-launch-token': health.launchToken
    };
    const admittedSource = await requestJson(sourcePath, { method: 'POST', headers, body: sourceBody });
    assert.equal(admittedSource.response.status, 201);
    assert.equal(admittedSource.payload.privacyMode, 'summary_only');

    const sessionResult = await requestJson(baseUrl + '/api/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sceneId: 'scene_main' })
    });
    assert.equal(sessionResult.response.status, 201);
    const sessionId = sessionResult.payload.session.id;
    assert.equal(reconnectSocket.destroyed, false, 'live reconnect socket closed before adapter ingress');

    const ingest = await withTimeout(openIngestSocket(port, health.launchToken), 3000, 'ingest websocket handshake');
    ingestSocket = ingest.socket;
    const websocketObservation = {
      schema: 'sidechannel.observation/2',
      id: 'smoke_ws_observation',
      sourceId: 'smoke_source',
      channel: 'heat',
      timestampMs: Date.now(),
      value: 23,
      unit: 'C',
      status: 'measured',
      quality: { score: 1, state: 'good', reasons: [] },
      position: { x: 2.2, y: 2.1 }
    };
    ingestSocket.write(maskedTextFrame(websocketObservation));
    const ingestResult = await withTimeout(ingest.nextFrame(), 3000, 'ingest result');
    assert.equal(ingestResult.type, 'ingest.result');
    assert.equal(ingestResult.ok, true);
    assert.equal(ingestResult.id, websocketObservation.id);
    const stateAfterIngest = await requestJson(baseUrl + '/api/state?view=compact');
    assert.ok(stateAfterIngest.payload.observations.some((observation) => observation.id === websocketObservation.id));
    let liveIngest = null;
    const liveEvents = [];
    for (let attempt = 0; attempt < 12 && !liveIngest; attempt += 1) {
      const event = await withTimeout(reconnect.nextFrame(), 1000, 'live websocket ingest event');
      liveEvents.push(event.type + ':' + (event.observation?.id || ''));
      if (event.type === 'observation.accepted' && event.observation?.id === websocketObservation.id) liveIngest = event;
    }
    assert.equal(liveIngest?.observation?.id, websocketObservation.id, liveEvents.join(', '));

    const simulatorStarted = await requestJson(baseUrl + '/api/adapter-runtime/' + encodeURIComponent('builtin:simulator') + '/start', {
      method: 'POST',
      headers: { 'x-sidechannel-launch-token': health.launchToken }
    });
    assert.equal(simulatorStarted.response.status, 200);
    assert.equal(simulatorStarted.payload.adapter.state, 'RUNNING');
    const startedRuntime = await requestJson(baseUrl + '/api/adapter-runtime');
    assert.equal(startedRuntime.payload.adapters.find((adapter) => adapter.manifest.providerId === 'builtin:simulator').state, 'RUNNING');
    let resumedEvent = null;
    let runtimeEvent = null;
    for (let attempt = 0; attempt < 12 && !resumedEvent; attempt += 1) {
      const event = await withTimeout(reconnect.nextFrame(), 1000, 'simulator restart event');
      if (event.type === 'adapter.runtime') runtimeEvent = event;
      if (event.type === 'observation.accepted' && /^sim_/.test(event.observation?.sourceId || '')) resumedEvent = event;
    }
    assert.equal(runtimeEvent?.adapter?.state, 'RUNNING');
    assert.equal(resumedEvent?.type, 'observation.accepted');
    assert.match(resumedEvent.observation?.sourceId || '', /^sim_/);

    let quarantinedRuntime = null;
    for (let failure = 0; failure < 3; failure += 1) {
      const failureResult = await requestJson(baseUrl + '/api/adapter-runtime/' + encodeURIComponent('builtin:simulator') + '/failure', {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'smoke quarantine ' + (failure + 1) })
      });
      assert.equal(failureResult.response.status, 200);
      if (failureResult.payload.adapter.state === 'QUARANTINED') quarantinedRuntime = failureResult.payload.adapter;
    }
    assert.equal(quarantinedRuntime?.state, 'QUARANTINED');
    const quarantinedState = await requestJson(baseUrl + '/api/adapter-runtime');
    assert.equal(quarantinedState.payload.adapters.find((adapter) => adapter.manifest.providerId === 'builtin:simulator').state, 'QUARANTINED');
    let quarantinedEvent = null;
    for (let attempt = 0; attempt < 18 && !quarantinedEvent; attempt += 1) {
      const event = await withTimeout(reconnect.nextFrame(), 1000, 'adapter quarantine event');
      if (event.type === 'adapter.runtime' && event.adapter?.state === 'QUARANTINED') quarantinedEvent = event;
    }
    assert.equal(quarantinedEvent?.adapter?.state, 'QUARANTINED');

    const observationResult = await requestJson(baseUrl + '/api/observations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schema: 'sidechannel.observation/2',
        id: 'smoke_observation',
        sourceId: 'smoke_source',
        channel: 'heat',
        timestampMs: Date.now(),
        value: 22,
        unit: 'C',
        status: 'measured',
        quality: { score: 1, state: 'good', reasons: [] },
        position: { x: 2, y: 2 }
      })
    });
    assert.equal(observationResult.response.status, 202);
    assert.equal(observationResult.payload.observation.id, 'smoke_observation');

    const stopped = await requestJson(baseUrl + '/api/sessions/' + sessionId + '/stop', { method: 'POST', headers });
    assert.equal(stopped.response.status, 200);
    assert.equal(stopped.payload.session.state, 'completed');

    const exported = await requestJson(baseUrl + '/api/sessions/' + sessionId + '/export');
    assert.equal(exported.response.status, 200);
    assert.equal(exported.payload.format, 'sidechannel-session');
    assert.ok(exported.payload.observations.some((observation) => observation.id === 'smoke_observation'));
    assert.equal(exported.payload.privacy.rawAudioIncluded, false);
    assert.equal(exported.payload.privacy.networkPayloadsIncluded, false);
    assert.equal(exported.payload.privacy.persistentDeviceIdsIncluded, false);

    const verified = await requestJson(baseUrl + '/api/sessions/' + sessionId + '/verify');
    assert.equal(verified.response.status, 200);
    assert.equal(verified.payload.ok, true);
    assert.equal(verified.payload.checks.privacyRetentionVerified, true);
    assert.equal(verified.payload.checks.observationSchemaVerified, true);

    const imported = await requestJson(baseUrl + '/api/sessions/import', {
      method: 'POST',
      headers,
      body: JSON.stringify(exported.payload)
    });
    assert.equal(imported.response.status, 201);
    const importedSessionId = imported.payload.session.id;
    assert.notEqual(importedSessionId, sessionId);
    assert.equal(imported.payload.session.state, 'completed');
    assert.equal(imported.payload.session.observations[0].evidenceState, 'imported');

    const importedReplay = await requestJson(baseUrl + '/api/sessions/' + importedSessionId + '/replay?mode=historical');
    assert.equal(importedReplay.response.status, 200);
    assert.equal(importedReplay.payload.replay.artifactState, 'recorded');
    assert.equal(importedReplay.payload.replay.sourceSessionId, importedSessionId);
    assert.ok(importedReplay.payload.replay.observations.some((observation) => observation.evidenceState === 'imported'));

    const importedVerification = await requestJson(baseUrl + '/api/sessions/' + importedSessionId + '/verify');
    assert.equal(importedVerification.response.status, 200);
    assert.equal(importedVerification.payload.ok, true);
    const deleted = await requestJson(baseUrl + '/api/sessions/' + importedSessionId, { method: 'DELETE', headers });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.payload.deleted, true);
    const deletedLookup = await requestJson(baseUrl + '/api/sessions/' + importedSessionId);
    assert.equal(deletedLookup.response.status, 404);

    const pruneMissingConfirm = await requestJson(baseUrl + '/api/sessions/prune', {
      method: 'POST',
      headers,
      body: JSON.stringify({ keep: 0 })
    });
    assert.equal(pruneMissingConfirm.response.status, 400);
    const pruned = await requestJson(baseUrl + '/api/sessions/prune', {
      method: 'POST',
      headers,
      body: JSON.stringify({ keep: 0, confirm: true })
    });
    assert.equal(pruned.response.status, 200);
    assert.ok(pruned.payload.deletedIds.includes(sessionId));
    assert.equal(pruned.payload.sessions.some((session) => session.id === sessionId), false);
  } finally {
    liveSocket?.destroy();
    reconnectSocket?.destroy();
    ingestSocket?.destroy();
    if (child.exitCode === null) {
      child.kill('SIGINT');
      await Promise.race([
        once(child, 'close'),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
