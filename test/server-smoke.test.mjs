import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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

test('loopback server smoke covers source admission, session lifecycle, and export verification', async () => {
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
  try {
    const health = await waitForHealth(baseUrl, child, stderr);
    assert.equal(health.loopbackOnly, true);
    assert.equal(typeof health.launchToken, 'string');

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
  } finally {
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
