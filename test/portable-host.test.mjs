import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function freePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();
  const port = address.port;
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  return port;
}

test('portable host supervises a healthy loopback server and shuts down', async () => {
  const port = await freePort();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'sidechannel-portable-host-'));
  const hostPath = resolve(import.meta.dirname, '../src/portable-host.mjs');
  const child = spawn(process.execPath, [hostPath, '--port', String(port), '--data-dir', dataDirectory], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 7000;
    while (!output.includes('sidechannel-portable-host/1') && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    assert.match(output, /sidechannel-portable-host\/1/);
    const ready = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(ready.loopbackOnly, true);
    assert.equal(ready.port, port);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).loopbackOnly, true);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGINT');
      await Promise.race([
        new Promise((resolvePromise) => child.once('close', resolvePromise)),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
      ]);
    }
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
