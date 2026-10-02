import { runSceneViewBenchmark, verifySceneViewBenchmarkReceipt } from '../src/verification/benchmark.mjs';

const iterations = Number(process.argv[2] || 20);
const sourceCount = Number(process.argv[3] || 9);
const receipt = runSceneViewBenchmark({
  iterations,
  sourceCount,
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});
console.log(JSON.stringify({ receipt, verification: verifySceneViewBenchmarkReceipt(receipt) }, null, 2));
