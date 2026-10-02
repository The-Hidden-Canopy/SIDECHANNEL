import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRuntimeManifest, verifyRuntimeBundle } from '../src/packaging.mjs';

const root = resolve(process.argv[2] || process.cwd());
const output = resolve(process.argv[3] || join(root, 'dist', 'sidechannel-runtime'));

try {
  await access(output);
  throw new Error('output directory already exists; choose a new path: ' + output);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const manifest = createRuntimeManifest(root);
await mkdir(output, { recursive: true });
for (const entry of manifest.files) {
  const destination = join(output, entry.path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, entry.path), destination);
}
const verification = verifyRuntimeBundle(output, manifest);
if (!verification.ok) throw new Error(verification.errors.join('; '));
await writeFile(join(output, 'sidechannel-runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  format: 'sidechannel-runtime-bundle-receipt/1',
  runtime: manifest.runtime,
  output,
  entrypoint: manifest.entrypoint,
  files: manifest.files.length,
  verified: true,
  limitations: [
    'Portable loopback bundle assembly only; no Node runtime, installer, signing, or desktop shell is included.',
    'The bundle remains local-first and keeps hardware adapters outside the software acceptance path.'
  ]
}, null, 2));
