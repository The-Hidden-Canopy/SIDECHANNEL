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
    id: 'privacy-admission-guards',
    label: 'Fail-closed privacy admission guards',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Source privacy modes and classes are validated; raw content and persistent device identity fields are rejected by default, explicit provider and privacy opt-in is required, sensitive values are omitted from normalized metadata, and imported packages reject retained sensitive fields.'
  },
  {
    id: 'security-posture',
    label: 'Threat and privacy posture',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A read-only local-software posture matrix exposes enforced transport/privacy controls and keeps deployment, consent, regulatory, and hardware-accuracy gates separate.'
  },
  {
    id: 'permission-revocation-cancellation',
    label: 'Permission revocation cancellation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Revoking an active subprocess permission cancels its run, records the reason, and leaves the provider disabled.'
  },
  {
    id: 'adapter-health-visuals',
    label: 'Adapter health and disconnect visuals',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Runtime adapter events drive explicit live, stale, waiting, disconnected, and quarantined source states in the local workspace.'
  },
  {
    id: 'bounded-scene-view',
    label: 'Bounded live SceneView contract',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The live workspace consumes a versioned, bounded SceneView containing source projections, current observations, adapter health, events, diagnostics, and explicit truncation limits.'
  },
  {
    id: 'scene-view-performance-receipt',
    label: 'SceneView performance receipt',
    status: 'implemented',
    evidenceLevel: 'E2',
    note: 'A bounded simulator benchmark records SceneView update latency and serialized payload percentiles with a tamper-detectable software receipt; it is not a production capacity claim.'
  },
  {
    id: 'safe-session-retention',
    label: 'Safe session retention pruning',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A confirmation-gated local prune route removes only older terminal sessions, preserves the newest keep count, and protects active recordings.'
  },
  {
    id: 'native-session-journal-replay',
    label: 'Native durable session journal and replay foundation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The native reference core persists hash-chained events and encoded observation rows, recovers unclosed files as interrupted, and verifies replay parity; it is not yet native SQLite, IPC, desktop, or hardware authority.'
  },
  {
    id: 'native-local-ipc-contract',
    label: 'Bounded native local IPC contract',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The native reference exposes a token-authenticated sidechannel.native-ipc/1 stdio boundary with bounded frames and ping/status/shutdown commands; it is not a network, OS permission, deployment, or hardware claim.'
  },
  {
    id: 'native-c-api-control-surface',
    label: 'Opaque native C ABI control surface',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'sidechannel/c_api.h exposes bounded opaque-handle session control and IPC encoding with finite-value admission; it is an interoperability contract, not SQLite, deployment permission, or hardware authority.'
  },
  {
    id: 'native-scene-view-projection',
    label: 'Native bounded SceneView projection',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The native reference serializes sidechannel.scene-view/1 with deterministic observation ordering, source-health projections, evidence status, and hard truncation limits; it is a presentation projection, not renderer, scene-authoring, or hardware authority.'
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
    note: 'Region, path, ellipse, ray, cone, frustum, and volume supports are validated and sampled with bounded geometry metadata; unknown support remains non-spatial instead of being reduced to point precision.'
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
    id: 'cross-channel-cooccurrence-artifact',
    label: 'Cross-channel co-occurrence artifact',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A bounded evaluator compares normalized temporal changes across channels, retains input observation IDs and lag estimates, and labels the result co-occurrence rather than causation.'
  },
  {
    id: 'software-fault-campaign',
    label: 'Software fault campaign receipts',
    status: 'implemented',
    evidenceLevel: 'E2',
    note: 'A bounded repeatable campaign exercises stale publication, ordering, adapter framing, range, permission, journal, spatial, and privacy rejection paths and emits a tamper-detectable software receipt.'
  },
  {
    id: 'adaptive-tile-evaluation',
    label: 'Adaptive tile field evaluation',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A bounded adaptive 2D estimator refines high-variation tiles under a hard tile budget while retaining separate value/support outputs and input lineage.'
  },
  {
    id: 'deterministic-evaluation-graph',
    label: 'Deterministic evaluation graph receipts',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Field evaluation emits selector, spatial resolver, estimator, confidence, and publication-gate node receipts with dependency digests and stale-candidate outcomes.'
  },
  {
    id: 'bounded-estimator-registry',
    label: 'Bounded estimator registry',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The evaluation graph can select IDW, nearest-source, Gaussian-kernel, temporal-decay, region-constant, or vector-magnitude estimators under bounded parameters; outputs remain derived.'
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
    id: 'layer-groups',
    label: 'Grouped layer controls',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Signals, evidence overlays, and scene context can be shown or hidden as groups while each underlying layer remains independently toggleable.'
  },
  {
    id: 'calibration-age-visuals',
    label: 'Calibration and data-age visuals',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'Source marks expose stale age, uncalibrated state, and inferred/derived shape semantics without changing admitted values or status.'
  },
  {
    id: 'paused-live-view',
    label: 'Paused live view',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace can freeze presentation updates while the loopback stream, admission, and active recording continue receiving data.'
  },
  {
    id: 'field-interpolation-controls',
    label: 'Field interpolation controls',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace exposes inverse-distance power and bounded search radius controls; cells outside the radius remain insufficient-data instead of being filled.'
  },
  {
    id: 'activity-channel-weights',
    label: 'Unified activity channel weights',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The live unified activity presentation exposes bounded 0–2 weights per channel; zero excludes a channel without changing raw observations or recorded sessions.'
  },
  {
    id: 'baseline-anomaly-overlay',
    label: 'Baseline anomaly overlay',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A bounded local baseline window computes normalized mean and standard deviation per source channel and renders a capped signed z-score overlay; it is not added to session exports.'
  },
  {
    id: 'scene-camera-tilt',
    label: 'Scene camera tilt',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The canvas offers bounded pseudo-3D camera tilt while pointer mapping, measurements, and evidence remain authoritative in the 2D scene frame.'
  },
  {
    id: 'local-scene-directory',
    label: 'Local multi-scene directory',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace can create and activate bounded local scenes; activation restarts only the software simulator and never rewrites recorded sessions.'
  },
  {
    id: 'reconnect-compact-snapshot',
    label: 'Reconnect compact snapshot',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The live client requests a bounded current-state snapshot after each WebSocket open, including reconnects, without requiring a browser refresh.'
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
    id: 'transform-authoring-surface',
    label: 'Transform authoring surface',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'The workspace publishes bounded revisioned frame edges, resolves acyclic multi-edge paths, and shows translation and scale; this is software frame metadata, not physical calibration proof.'
  },
  {
    id: 'local-background-layer',
    label: 'Local imported background layer',
    status: 'implemented',
    evidenceLevel: 'E1',
    note: 'A bounded PNG, JPEG, or WebP data URL can be placed in scene coordinates and rendered beneath evidence layers; remote assets are not admitted.'
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
    note: 'C++23 simulator and dependency-free session package fixtures are checked against Node contracts, including canonical observation-row semantic parity; native SQLite authority is not claimed.'
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
