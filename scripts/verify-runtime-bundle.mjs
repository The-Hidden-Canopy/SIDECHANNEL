import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeBundle } from '../src/packaging.mjs';

const root = resolve(process.argv[2] || process.cwd());
const requestedBundle = process.argv[3] ? resolve(process.argv[3]) : null;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'sidechannel-runtime-bundle-'));
const bundle = requestedBundle || join(workspace, 'bundle');
let host = null;

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

function runProcess(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`process exited with ${code}: ${stderr || stdout}`));
    });
  });
}

async function waitForReady(output) {
  const deadline = Date.now() + 7_000;
  while (!output.text.includes('sidechannel-portable-host/1') && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (!output.text.includes('sidechannel-portable-host/1')) {
    throw new Error(`portable bundle host did not become ready: ${output.text || '(no stdout)'}`);
  }
  const line = output.text.trim().split(/\r?\n/).findLast((entry) => entry.includes('sidechannel-portable-host/1'));
  const receipt = JSON.parse(line);
  if (receipt.loopbackOnly !== true || receipt.port !== output.port) {
    throw new Error('portable bundle host emitted an invalid ready receipt');
  }
  return receipt;
}

async function stopHost() {
  if (!host || host.exitCode !== null) return;
  host.kill('SIGINT');
  await Promise.race([
    new Promise((resolvePromise) => host.once('close', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))
  ]);
  if (host.exitCode === null) host.kill();
}

try {
  if (!requestedBundle) {
    await runProcess(process.execPath, [join(scriptDirectory, 'package-runtime.mjs'), root, bundle]);
  }

  const manifestPath = join(bundle, 'sidechannel-runtime-manifest.json');
  await access(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const verification = verifyRuntimeBundle(bundle, manifest);
  if (!verification.ok) throw new Error(verification.errors.join('; '));

  const port = await freePort();
  const dataDirectory = join(workspace, 'smoke-data');
  const hostPath = join(bundle, 'src', 'portable-host.mjs');
  const output = { text: '', port };
  host = spawn(process.execPath, [hostPath, '--port', String(port), '--data-dir', dataDirectory], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  host.stdout.on('data', (chunk) => { output.text += chunk.toString(); });
  let stderr = '';
  host.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const ready = await waitForReady(output);
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const health = await healthResponse.json();
  if (healthResponse.status !== 200 || health.ok !== true || health.loopbackOnly !== true) {
    throw new Error('portable bundle health contract failed');
  }
  const shellResponse = await fetch(`http://127.0.0.1:${port}/`);
  const shell = await shellResponse.text();
  if (shellResponse.status !== 200 || !shell.includes('SIDECHANNEL')) {
    throw new Error('portable bundle browser shell failed');
  }

  console.log(JSON.stringify({
    format: 'sidechannel-runtime-bundle-smoke/1',
    bundle,
    files: manifest.files.length,
    manifestVerified: true,
    hostReady: true,
    healthOk: true,
    shellOk: true,
    loopbackOnly: ready.loopbackOnly,
    limitations: [
      'This gate proves the assembled Node loopback bundle launches and serves its shell; it does not include a Node runtime, installer, signing, native desktop shell, or physical adapter authority.'
    ]
  }, null, 2));
} catch (error) {
  await stopHost();
  throw error;
} finally {
  await stopHost();
  if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
