import { runSoftwareBenchmark } from '../src/verification/benchmark.mjs';

const ticks = Number(process.argv[2] || 8);
const gridSize = Number(process.argv[3] || 14);
const receipt = runSoftwareBenchmark({
  ticks,
  gridSize,
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});
console.log(JSON.stringify(receipt, null, 2));
