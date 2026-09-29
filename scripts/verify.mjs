import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = [
  ...readdirSync(join(root, 'src'), { recursive: true })
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => join(root, 'src', file)),
  join(root, 'public', 'app.js')
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const tests = spawnSync(process.execPath, ['--test'], { stdio: 'inherit' });
process.exit(tests.status || 0);
