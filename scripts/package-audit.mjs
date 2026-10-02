import { resolve } from 'node:path';
import { createRuntimeManifest, verifyRuntimeManifest } from '../src/packaging.mjs';

const root = resolve(process.argv[2] || process.cwd());
try {
  const manifest = createRuntimeManifest(root);
  const verification = verifyRuntimeManifest(manifest);
  if (!verification.ok) throw new Error(verification.errors.join('; '));
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
} catch (error) {
  console.error('package audit failed: ' + error.message);
  process.exitCode = 1;
}
