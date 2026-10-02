import { readFile } from 'node:fs/promises';
import { verifySessionPackage } from '../src/session-verifier.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run verify:session -- path/to/session.json');
  process.exit(2);
}

let report;
try {
  report = verifySessionPackage(JSON.parse(await readFile(path, 'utf8')));
} catch (error) {
  console.error(JSON.stringify({ ok: false, reasons: [error.message] }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
