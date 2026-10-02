import { runSoftwareBenchmark, verifySoftwareBenchmarkReceipt } from '../src/verification/benchmark.mjs';

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

console.log(JSON.stringify({
  format: 'sidechannel-benchmark-matrix',
  formatVersion: '0.1',
  evidenceLevel: 'E2',
  profiles: results,
  limitations: [
    'All profiles use generated simulator sources and software-only field evaluation.',
    'Timing varies by host and is not a production capacity, memory, or deployment claim.',
    'S4 burst and physical-source campaigns remain unimplemented follow-on work.'
  ]
}, null, 2));
