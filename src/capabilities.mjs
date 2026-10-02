export const CAPABILITY_MATRIX = Object.freeze([
  {
    id: 'unified-spatial-scene',
    label: 'Unified spatial scene',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Local 2D scene, source placement, channel layers, and inferred fields are available.'
  },
  {
    id: 'deterministic-simulator',
    label: 'Deterministic simulator',
    status: 'implemented',
    evidenceLevel: 'E2',
    note: 'Seeded nine-channel simulator with replay and benchmark receipts.'
  },
  {
    id: 'local-recording-replay',
    label: 'Local recording and replay',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'SQLite sessions, frozen snapshots, historical replay, recompute, and verification.'
  },
  {
    id: 'calibration-provenance-gates',
    label: 'Calibration provenance gates',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Calibration reuse fails closed unless provider and source-profile digests match and the record is valid and unexpired.'
  },
  {
    id: 'native-reference-parity',
    label: 'Native reference parity',
    status: 'reference-only',
    evidenceLevel: 'E2',
    note: 'C++23 simulator fixture is compared with the Node reference; native persistence is not claimed.'
  },
  {
    id: 'physical-adapters',
    label: 'Physical sensing adapters',
    status: 'hardware-gated',
    evidenceLevel: 'E0',
    note: 'Provider contracts and supervision exist, but no physical source is exercised by this build.'
  },
  {
    id: 'desktop-shell',
    label: 'Native desktop shell',
    status: 'planned',
    evidenceLevel: 'E0',
    note: 'The current product surface is a loopback web UI.'
  },
  {
    id: 'cloud-deployment',
    label: 'Cloud deployment',
    status: 'out-of-scope',
    evidenceLevel: 'E0',
    note: 'This repository is local-first and loopback-only.'
  },
  {
    id: 'actuation',
    label: 'Physical actuation',
    status: 'not-supported',
    evidenceLevel: 'E0',
    note: 'The runtime observes and derives; it does not control devices.'
  }
]);

export function capabilitySnapshot() {
  return {
    format: 'sidechannel-capability-matrix',
    formatVersion: '0.1',
    claims: CAPABILITY_MATRIX.map((claim) => ({ ...claim }))
  };
}
