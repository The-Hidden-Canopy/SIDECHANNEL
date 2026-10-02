# SIDECHANNEL

SIDECHANNEL is a local-first spatial sensing explorer for making incidental emissions visible in one shared scene. It is designed to bring RF, magnetic field, heat, vibration, sound features, network rates, electrical load, Bluetooth aggregates, and light flicker into a common coordinate system.

## Current repository contents

- `outputs/SIDECHANNEL_BUILD_SPEC.md` — product plan, engineering specification, data contracts, architecture, milestones, and Codex execution brief.
- `src/` — normalized contracts, validation/freshness gates, spatial interpolation, simulator, SQLite session store, event detection, and loopback server.
- `native/` — C++23 reference-core slice with deterministic simulator and bounded admission sequencer.
- `CMakeLists.txt` — native build and CTest entry point.
- `public/` — responsive 2D scene explorer with channel layers, source health, inspector, diagnostics, activity events, recording, replay, and export controls.
- `test/` — deterministic simulator, validation, freshness, spatial field, and activity-fusion tests.
- `docs/PACKAGING.md` — runtime, verification, portable packaging boundary, and data-directory runbook.
- `package.json` — Node.js project manifest.

## Safety and privacy boundaries

The intended implementation is loopback-only and local-first. It must not store raw audio, network payloads, or persistent device identities by default, and it must not provide physical actuation or imply that correlation proves causality.

## Run locally

Requirements: Node.js 22 or newer. No dependency installation is required for the current slice.

```text
npm test
npm run verify
npm run verify:session -- path/to/exported-session.json
npm run receipt:session -- path/to/exported-session.json
npm run benchmark -- 8 14
npm run benchmark:matrix
npm run benchmark:burst -- 10000 8 1024
npm run verify:benchmark -- path/to/benchmark-receipt.json
npm start
```

Open http://127.0.0.1:4173/.

The server is loopback-only by default. It starts a deterministic simulator with nine positioned channel sources and exposes `/api/health`, `/api/state`, `/api/adapters`, `/api/adapter-runtime`, `/api/benchmark`, `/api/benchmark/burst`, and `/api/capabilities` plus loopback supervisor controls, `/api/calibrations`, `/api/transforms`, scene/source authoring, HTTP observation ingestion, `/ws/live` live updates, `/ws/ingest` normalized observation input, session recording, historical/recomputed/determinism replay, session comparison, within-session temporal comparison, and privacy-labelled JSON export. Each process issues an ephemeral launch token through health/state; state-changing HTTP requests require `x-sidechannel-launch-token`, and `/ws/ingest` requires the token query parameter.

## Implemented v0.1 slice

The current engineering tranche is runnable now: deterministic simulator, normalized observation contracts, provider-manifest admission, explicit evidence/privacy classes, provenance edges, versioned calibration records, fail-closed calibration provenance compatibility gates, runtime-derived source-profile identities, bounded pose history and pose-required spatial resolution, geometry-aware support sampling, explicit spatial support geometry, revisioned transforms with a workspace authoring surface and bounded acyclic multi-edge resolution, bounded local imported background layers with scene-space placement, grouped layer controls with independent child toggles, explicit calibration/data-age and inferred/derived source-marker semantics, a paused live view that does not stop ingestion or recording, configurable inverse-distance power and search-radius masking with insufficient-data cells, a bounded local baseline window with normalized mean/std-dev and capped signed z-score anomaly-relative overlay, bounded pseudo-3D camera tilt with inverse pointer mapping, a local multi-scene directory and explicit scene activation with simulator restart, reconnect-safe compact current-state snapshots, separate field value/support outputs, revision-gated field candidates, append-only hash-chain session journal with recorded calibration/transform/provider/permission mutations, versioned adapter frames, permission-gated adapter lifecycle and quarantine, bounded supervised subprocess adapter transport, loopback Host/Origin and bounded WebSocket checks, loopback API/WebSocket live updates, bounded ordered ingress, duplicate admission rejection, inbound WebSocket and JSON-lines adapter modules, adapter discovery, 2D scene renderer, inverse-distance visual fields, a weighted Unified activity layer, independently toggleable support/confidence, uncertainty, replay-trail, activity-event, and baseline overlays, bounded room/zone polygons, bounded door/portal segments, a scene-unit selector and measurement ruler, optional passphrase-encrypted session export/import, bounded activity-change events, quality/freshness gates, diagnostics, scene-frame editing, draggable source calibration, manual source creation and numeric observation injection, immutable per-session scene/source/calibration/transform snapshots, historical session export, independent session verification, SQLite recording/replay data, JSON export/import controls, local session deletion, and automated tests.

Replay is explicit about truth: `/api/sessions/:id/replay?mode=historical` returns retained recorded artifacts from the frozen session snapshot, `mode=recompute` returns a derived activity field, and `mode=determinism` compares two recomputations. `POST /api/sessions/compare` produces a derived difference artifact between two self-contained sessions; `POST /api/sessions/compare-time` compares two pinned times from one retained session. The workspace labels both results as derived and preserves source session/timestamp provenance. `/api/sessions/:id/receipt` and `npm run receipt:session -- path/to/exported-session.json` produce a replay receipt with an evidence level, digests, counts, and explicit software-only limitations. `POST /api/benchmark` runs the same bounded simulator path used by `npm run benchmark` and returns an E2 benchmark receipt plus independent verification; `POST /api/benchmark/burst` and `npm run benchmark:burst` exercise bounded backpressure with a 10,000-frame simulator burst; `npm run benchmark:matrix` exercises generated-source profiles S0–S3 plus S4-burst; `npm run verify:benchmark -- path/to/benchmark-receipt.json` checks a saved receipt for structural consistency, replay consistency, monotonic latency percentiles, and digest tampering. These are software measurements, not production capacity claims. The Runtime evidence panel exposes both the single-run and bounded burst checks in the UI. Open sessions are marked `interrupted` after a process restart and are never resumed or silently completed.

`/api/capabilities` and the Capability gates panel make the claims boundary explicit: implemented local software, native reference-only parity, hardware-gated adapters, planned desktop packaging, and unsupported actuation/cloud claims are separately labelled with evidence levels. Session exports now carry a package-level SHA-256 digest in addition to the frozen snapshot digest and journal chain.

Native hardware adapters, richer calibration, and desktop packaging remain follow-on work described in the build specification. The SQLite store is local and dependency-free on supported Node.js releases; it migrates an existing `data/sidechannel.json` file on first startup.

GitHub Actions runs the Node reference tests plus native CTest/parity on Ubuntu and Windows; passing CI is software evidence only and is not a hardware, deployment, or regulated-operation claim.

The native directory is an independently tested reference slice. It now emits a dependency-free session-package fixture that the Node verifier checks for canonical observation shape, frozen snapshot digest, and retained references, but it is not yet the authority for SQLite persistence, local IPC, or full semantic export parity. Build it with the CMake instructions in `native/README.md` and run `npm run verify:native-session -- path/to/sidechannel-native.exe 2` for the package gate.

See the build specification for the authoritative requirements.
