import { readFile } from 'node:fs/promises';
import { verifyBurstBenchmarkReceipt, verifySceneViewBenchmarkReceipt, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/verify-benchmark.mjs path/to/benchmark-receipt.json');
  process.exit(1);
}

const payload = JSON.parse(await readFile(path, 'utf8'));
const receipt = payload.receipt || payload;
const verification = receipt.format === 'sidechannel-burst-benchmark-receipt'
  ? verifyBurstBenchmarkReceipt(receipt)
  : receipt.format === 'sidechannel-scene-view-benchmark-receipt'
    ? verifySceneViewBenchmarkReceipt(receipt)
    : verifySoftwareBenchmarkReceipt(receipt);
console.log(JSON.stringify(verification, null, 2));
if (!verification.ok) process.exit(1);
