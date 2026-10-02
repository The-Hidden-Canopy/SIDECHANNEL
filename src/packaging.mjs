import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const RUNTIME_MANIFEST_FORMAT = 'sidechannel-runtime-manifest/1';
export const RUNTIME_REQUIRED_FILES = Object.freeze([
  'package.json',
  'README.md',
  'docs/PACKAGING.md',
  'src/server.mjs',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/baseline.mjs',
  'public/render-budget.mjs'
]);
export const RUNTIME_EXCLUDED_PATHS = Object.freeze([
  'data/',
  'build/',
  'dist/',
  'coverage/',
  'node_modules/',
  '.git/',
  'native/'
]);

function normalizedPath(value) {
  return value.split(sep).join('/');
}

function walkFiles(root, directory) {
  const absoluteDirectory = join(root, directory);
  const entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(root, child);
    if (!entry.isFile()) return [];
    return [normalizedPath(child)];
  });
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function createRuntimeManifest(root) {
  const absoluteRoot = root;
  const sourceFiles = walkFiles(absoluteRoot, 'src').filter((file) => file.endsWith('.mjs'));
  const publicFiles = walkFiles(absoluteRoot, 'public');
  const fixedFiles = ['package.json', 'README.md', 'docs/PACKAGING.md'];
  const files = [...new Set([...fixedFiles, ...sourceFiles, ...publicFiles])].sort();

  const missing = RUNTIME_REQUIRED_FILES.filter((file) => !files.includes(file) || !statSync(join(absoluteRoot, file), { throwIfNoEntry: false }));
  if (missing.length) throw new Error('runtime manifest missing required files: ' + missing.join(', '));
  const excludedIncluded = files.filter((file) => RUNTIME_EXCLUDED_PATHS.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)));
  if (excludedIncluded.length) throw new Error('runtime manifest includes excluded paths: ' + excludedIncluded.join(', '));

  return {
    format: RUNTIME_MANIFEST_FORMAT,
    runtime: 'node-loopback-web',
    entrypoint: 'src/server.mjs',
    browserEntrypoint: 'public/index.html',
    requiredFiles: [...RUNTIME_REQUIRED_FILES],
    excludedPaths: [...RUNTIME_EXCLUDED_PATHS],
    files: files.map((file) => ({
      path: file,
      bytes: statSync(join(absoluteRoot, file)).size,
      sha256: sha256(join(absoluteRoot, file))
    }))
  };
}

export function verifyRuntimeManifest(manifest) {
  const errors = [];
  if (manifest?.format !== RUNTIME_MANIFEST_FORMAT) errors.push('unsupported manifest format');
  if (manifest?.runtime !== 'node-loopback-web') errors.push('unsupported runtime');
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const paths = new Set(files.map((file) => file?.path));
  for (const required of RUNTIME_REQUIRED_FILES) {
    if (!paths.has(required)) errors.push('missing required file: ' + required);
  }
  for (const file of files) {
    const pathIsSafe = file && typeof file.path === 'string' &&
      !file.path.startsWith('/') &&
      !file.path.includes('../') &&
      file.path !== '.' &&
      file.path !== '..' &&
      /^([a-z0-9._-]+\/)*[a-z0-9._-]+$/i.test(file.path);
    if (!pathIsSafe) {
      errors.push('invalid runtime file path');
      continue;
    }
    if (RUNTIME_EXCLUDED_PATHS.some((prefix) => file.path === prefix.slice(0, -1) || file.path.startsWith(prefix))) {
      errors.push('excluded path present: ' + file.path);
    }
    if (!Number.isInteger(file.bytes) || file.bytes < 0) errors.push('invalid byte count: ' + file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) errors.push('invalid digest: ' + file.path);
  }
  return { ok: errors.length === 0, errors };
}
