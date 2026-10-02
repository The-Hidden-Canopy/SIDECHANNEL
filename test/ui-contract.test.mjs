import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('evidence inspector exposes the bounded observation lineage contract', () => {
  for (const field of [
    "detail('Provider digest'",
    "detail('Source profile'",
    "detail('Transform revision'",
    "detail('Pose'",
    "detail('Support'",
    "detail('Input observations'",
    "detail('Provenance'",
    "detail('Sequence'",
    "detail('Age'"
  ]) {
    assert.ok(appSource.includes(field), 'missing inspector field: ' + field);
  }
  assert.match(appSource, /escapeHtml\(value\)/);
  assert.match(appSource, /\/api\/sessions\/.*\/verify/);
  assert.match(appSource, /sessionVerification/);
});
