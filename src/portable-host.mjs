import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = join(sourceDirectory, 'server.mjs');
const argumentsList = process.argv.slice(2);

function argumentValue(name, fallback = null) {
  const index = argumentsList.indexOf(name);
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
}

function parsePort(raw) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('port must be an integer between 1024 and 65535');
  return port;
}

const port = parsePort(argumentValue('--port', process.env.PORT || '4173'));
const dataDirectory = argumentValue('--data-dir', process.env.SIDECHANNEL_DATA_DIR);
const childEnvironment = {
  ...process.env,
  PORT: String(port),
  ...(dataDirectory ? { SIDECHANNEL_DATA_DIR: resolve(dataDirectory) } : {})
};

const child = spawn(process.execPath, [serverPath], {
  env: childEnvironment,
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', (chunk) => process.stderr.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

let shuttingDown = false;
function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill('SIGINT');
  const forceExit = setTimeout(() => process.exit(exitCode), 3000);
  forceExit.unref();
  child.once('close', () => {
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
}

child.once('error', (error) => {
  console.error('portable host failed to start: ' + error.message);
  stop(1);
});
child.once('close', (code) => {
  if (!shuttingDown && code !== 0) process.exit(code || 1);
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

let ready = false;
for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (response.ok) {
      const health = await response.json();
      ready = health.ok === true && health.loopbackOnly === true;
    }
  } catch {
    // The supervised server may still be binding its loopback listener.
  }
}

if (!ready) {
  console.error('portable host did not become healthy within 5 seconds');
  stop(1);
} else {
  console.log(JSON.stringify({
    format: 'sidechannel-portable-host/1',
    url: `http://127.0.0.1:${port}/`,
    port,
    loopbackOnly: true,
    supervisedPid: child.pid,
    dataDirectory: dataDirectory ? resolve(dataDirectory) : null,
    limitations: [
      'Portable local host only; no installer, signing, native desktop shell, or physical adapter authority.',
      'The child server remains loopback-only and requires a supported Node.js runtime.'
    ]
  }));
}
