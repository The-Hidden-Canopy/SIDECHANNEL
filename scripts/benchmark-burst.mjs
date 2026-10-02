import { runBurstBenchmark, verifyBurstBenchmarkReceipt } from '../src/verification/benchmark.mjs';

const receipt = await runBurstBenchmark({
  frames: Number(process.argv[2] || 10_000),
  sourceCount: Number(process.argv[3] || 8),
  queueCapacity: Number(process.argv[4] || 1_024),
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});
console.log(JSON.stringify({ receipt, verification: verifyBurstBenchmarkReceipt(receipt) }, null, 2));
