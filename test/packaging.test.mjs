import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  RUNTIME_EXCLUDED_PATHS,
  RUNTIME_MANIFEST_FORMAT,
  RUNTIME_REQUIRED_FILES,
  createRuntimeManifest,
  verifyRuntimeManifest
} from '../src/packaging.mjs';

const root = resolve(import.meta.dirname, '..');

test('runtime manifest covers the portable loopback bundle boundary', () => {
  const manifest = createRuntimeManifest(root);
  assert.equal(manifest.format, RUNTIME_MANIFEST_FORMAT);
  assert.equal(manifest.entrypoint, 'src/server.mjs');
  assert.deepEqual(manifest.excludedPaths, RUNTIME_EXCLUDED_PATHS);
  assert.ok(manifest.files.length >= RUNTIME_REQUIRED_FILES.length);
  assert.deepEqual(verifyRuntimeManifest(manifest), { ok: true, errors: [] });
  for (const required of RUNTIME_REQUIRED_FILES) {
    const entry = manifest.files.find((file) => file.path === required);
    assert.ok(entry, 'missing manifest entry: ' + required);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.bytes > 0);
  }
  assert.equal(manifest.files.some((file) => file.path.startsWith('data/')), false);
  assert.equal(manifest.files.some((file) => file.path.startsWith('native/')), false);
});

test('runtime manifest verifier rejects missing, excluded, and malformed entries', () => {
  const manifest = createRuntimeManifest(root);
  const tampered = {
    ...manifest,
    files: manifest.files
      .filter((file) => file.path !== 'public/app.js')
      .concat([
        { path: 'data/sidechannel.sqlite', bytes: 10, sha256: '0'.repeat(64) },
        { path: '../outside', bytes: 1, sha256: '0'.repeat(64) }
      ])
  };
  const report = verifyRuntimeManifest(tampered);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('public/app.js')));
  assert.ok(report.errors.some((error) => error.includes('excluded path')));
  assert.ok(report.errors.some((error) => error.includes('invalid runtime file path')));
});
