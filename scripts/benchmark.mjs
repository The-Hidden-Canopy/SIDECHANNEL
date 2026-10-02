import { runSoftwareBenchmark, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

const ticks = Number(process.argv[2] || 8);
const gridSize = Number(process.argv[3] || 14);
const sourceCount = Number(process.argv[4] || 9);
const receipt = runSoftwareBenchmark({
  ticks,
  gridSize,
  sourceCount,
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});
console.log(JSON.stringify({ receipt, verification: verifySoftwareBenchmarkReceipt(receipt) }, null, 2));
