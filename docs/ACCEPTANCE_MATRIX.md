# SIDECHANNEL acceptance matrix

This matrix maps the attached spatial-evidence docuseries work packages to the current repository evidence. The attached documents are treated as product and engineering reference; they do not override runtime safety, privacy, or authorization boundaries.

## Software-only work packages

| Work package | Status | Evidence in this repository |
| --- | --- | --- |
| SC-01 Historical correctness | Implemented | Immutable per-session scene/source/calibration/transform snapshots, historical replay/export, package digest, and regression coverage in `src/sqlite-store.mjs`, `src/session-verifier.mjs`, `test/sqlite-store.test.mjs`, and `test/session-verifier.test.mjs`. |
| SC-02 Admission sequencer | Implemented | Bounded ordered ingress, duplicate rejection, source-time ordering, and detector protection in `src/admission/sequencer.mjs`, `src/events.mjs`, and the server smoke/fault tests. |
| SC-03 Provenance and calibration | Implemented | Provider manifests, source-profile identity, calibration compatibility, evidence/privacy state, and lineage in `src/admission/`, `src/calibration/`, `src/identity/`, `src/provenance/`, and `src/privacy.mjs`. |
| SC-04 Spatial graph | Implemented | Revisioned transforms, bounded pose history, point/region/path/directional/volume support, rooms, portals, background placement, and measurement controls in `src/spatial/` and `public/app.js`. |
| SC-05 Evaluation graph | Implemented | Bounded estimators, adaptive fields, dependency digests, stale publication gates, and derived co-occurrence artifacts in `src/evaluation/`, `src/spatial/adaptive.mjs`, and their tests. |
| SC-06 Adapter supervisor | Implemented | Versioned JSONL/WebSocket/subprocess contracts, permissions, cancellation, bounded output, quarantine, and diagnostics in `src/adapters/` and `test/adapter-runtime.test.mjs`. |
| SC-07 Native core | Implemented as reference-only | C++23 simulator, file and SQLite/WAL authorities, C ABI, bounded local IPC, SceneView projection, Node parity, native-to-reference import roundtrip, and native benchmark receipts in `native/` and `scripts/verify-native-*.mjs`. |
| SC-08 Product shell and visualization | Implemented in bounded form | Browser-first live workspace, replay/inspector/diagnostics surfaces, bounded SceneView contract, portable host, assembled-bundle smoke gate, and native SceneView projection. Native desktop technology and optional VANTA renderer remain deliberately undecided. |
| SC-09 Software evidence campaign | Implemented for simulated/reference paths | S0–S4 benchmark matrix, SceneView/burst receipts, software fault campaign, native persistence receipts, package audit, and capability matrix. Real-source campaigns remain hardware-gated. |

## Verification gates

The completed software-only gate set is:

- `npm run verify` — 135 Node tests, including loopback integration and package import/export checks.
- `ctest --test-dir build/native-nmake2 -C Debug --output-on-failure` — 2 native tests on the local MSVC build.
- `npm run package:audit` — deterministic runtime manifest with mutable state, native sources, and build output excluded.
- `npm run verify:runtime-bundle` — assembled bundle launch, loopback health, browser shell, and clean shutdown.
- `npm run verify:native-roundtrip -- path/to/sidechannel-native.exe 2` — native export through independent reference import, provenance, evidence relabelling, and import journaling.
- GitHub Actions — Node, Ubuntu/Windows native, and Ubuntu sanitizer jobs are configured; CI results remain software evidence only.

## Explicit remaining gates

These are not claimed by this repository tranche:

- physical RF, magnetic, thermal, vibration, audio, Bluetooth, light, electrical, or network sensor accuracy;
- operating-system permission authority, deployment approval, installer/signing, or production capacity;
- a native desktop shell, because the shell technology remains an open product decision;
- cloud deployment or physical actuation;
- consent, regulatory, or safety approval for real-world operation.

