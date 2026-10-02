import { readFile } from 'node:fs/promises';
import { verifyNativeBenchmarkReceipt } from '../src/verification/native-benchmark.mjs';

const receiptPath = process.argv[2];
if (!receiptPath) {
  console.error('usage: node scripts/verify-native-benchmark.mjs path/to/native-benchmark-receipt.json');
  process.exit(2);
}

const parsed = JSON.parse(await readFile(receiptPath, 'utf8'));
const receipt = parsed?.receipt && parsed.receipt.format === 'sidechannel-native-benchmark-receipt'
  ? parsed.receipt
  : parsed;
const verification = verifyNativeBenchmarkReceipt(receipt);
console.log(JSON.stringify(verification, null, 2));
if (!verification.ok) process.exit(1);
