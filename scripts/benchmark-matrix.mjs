import { runBurstBenchmark, runSoftwareBenchmark, verifyBurstBenchmarkReceipt, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

const profiles = [
  { id: 'S0', sourceCount: 8, ticks: 10, gridSize: 14 },
  { id: 'S1', sourceCount: 32, ticks: 10, gridSize: 18 },
  { id: 'S2', sourceCount: 128, ticks: 4, gridSize: 22 },
  { id: 'S3', sourceCount: 512, ticks: 2, gridSize: 28 }
];

const results = profiles.map((profile) => {
  const receipt = runSoftwareBenchmark({
    ...profile,
    runId: 'matrix_' + profile.id,
    sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
  });
  return { profile, receipt, verification: verifySoftwareBenchmarkReceipt(receipt) };
});
const burstReceipt = await runBurstBenchmark({
  frames: 10_000,
  sourceCount: 8,
  queueCapacity: 1_024,
  runId: 'matrix_S4_burst',
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});

console.log(JSON.stringify({
  format: 'sidechannel-benchmark-matrix',
  formatVersion: '0.1',
  evidenceLevel: 'E2',
  profiles: results,
  burstProfile: { id: 'S4-burst', receipt: burstReceipt, verification: verifyBurstBenchmarkReceipt(burstReceipt) },
  limitations: [
    'All profiles use generated simulator sources and software-only field evaluation.',
    'Timing varies by host and is not a production capacity, memory, or deployment claim.',
    'S4 is a bounded 10,000-frame software burst, not a 10,000-frames-per-second production capacity claim.',
    'Physical-source campaigns remain unimplemented follow-on work.'
  ]
}, null, 2));
