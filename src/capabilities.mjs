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
    id: 'runtime-source-profile-identity',
    label: 'Runtime source-profile identity',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Source profile digests are derived from measurement identity and policy fields; placement changes do not silently change the profile.'
  },
  {
    id: 'provider-identity-admission',
    label: 'Provider identity admission',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'When a source has a provider manifest, frame provider id and digest claims must match that registered manifest.'
  },
  {
    id: 'permission-revocation-cancellation',
    label: 'Permission revocation cancellation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Revoking an active subprocess permission cancels its run, records the reason, and leaves the provider disabled.'
  },
  {
    id: 'bounded-websocket-controls',
    label: 'Bounded WebSocket controls',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Loopback WebSockets answer bounded ping frames with pong, acknowledge close handshakes, and emit protocol-error closes for invalid control frames.'
  },
  {
    id: 'calibration-transform-binding',
    label: 'Calibration transform binding',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Calibration reuse is bound to the current transform revision so spatial-anchor changes invalidate new use.'
  },
  {
    id: 'authoritative-mutation-journal',
    label: 'Authoritative mutation journal',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Recorded sessions retain hash-chained calibration, transform, provider, and permission mutation events.'
  },
  {
    id: 'bounded-pose-history',
    label: 'Bounded pose history',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Pose-required observations resolve to a nearest bounded sample and retain pose provenance; stale resolution fails closed.'
  },
  {
    id: 'geometry-aware-support-evaluation',
    label: 'Geometry-aware support evaluation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Region, path, and ellipse supports are validated and sampled with bounded geometry metadata instead of being reduced to point precision.'
  },
  {
    id: 'evidence-inspector-lineage',
    label: 'Evidence inspector lineage',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Selected observations expose source/provider identity, calibration and transform bindings, pose resolution, support geometry, sequence, age, inputs, and provenance.'
  },
  {
    id: 'session-verification-surface',
    label: 'Session verification surface',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The UI can run the independent package verifier and expose snapshot, journal, reference, pose, and observation checks for a selected local session.'
  },
  {
    id: 'derived-session-comparison-surface',
    label: 'Derived session comparison surface',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace can compare two self-contained sessions and labels cell differences as derived evidence with source-session provenance.'
  },
  {
    id: 'temporal-comparison-surface',
    label: 'Within-session temporal comparison',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Replay can pin two retained times and compare bounded recomputations from the same session, preserving both timestamps as derived provenance.'
  },
  {
    id: 'temporal-evidence-navigation',
    label: 'Temporal evidence navigation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Replay exposes activity and runtime-journal markers with bounded click-to-time navigation; markers remain historical evidence, not new measurements.'
  },
  {
    id: 'evidence-overlay-layers',
    label: 'Evidence overlay layers',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The scene independently toggles support/confidence, uncertainty geometry, replay trails, and activity-event pulses without changing observation truth.'
  },
  {
    id: 'scene-regions-and-zones',
    label: 'Scene rooms and zones',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Bounded room/zone polygons are validated, persisted with scene snapshots, rendered as a layer, and removable through the loopback workspace.'
  },
  {
    id: 'scene-measurement-ruler',
    label: 'Scene measurement ruler',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace reports bounded point-to-point distances in the scene unit without rewriting sensor observations or calibration records.'
  },
  {
    id: 'scene-portals',
    label: 'Scene doors and portals',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Bounded door/portal segments are validated, persisted in scene snapshots, rendered as an explicit layer, and removable through the loopback workspace.'
  },
  {
    id: 'encrypted-session-portability',
    label: 'Encrypted session portability',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Optional passphrase-encrypted export/import uses bounded scrypt key derivation and AES-256-GCM before the normal independent package verifier runs.'
  },
  {
    id: 'native-reference-parity',
    label: 'Native reference parity',
    status: 'reference-only',
    evidenceLevel: 'E2',
    note: 'C++23 simulator and dependency-free session package fixtures are checked against Node contracts; native SQLite authority is not claimed.'
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
