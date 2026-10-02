# SIDECHANNEL

SIDECHANNEL is a local-first spatial sensing explorer for making incidental emissions visible in one shared scene. It is designed to bring RF, magnetic field, heat, vibration, sound features, network rates, electrical load, Bluetooth aggregates, and light flicker into a common coordinate system.

## Current repository contents

- `outputs/SIDECHANNEL_BUILD_SPEC.md` — product plan, engineering specification, data contracts, architecture, milestones, and Codex execution brief.
- `src/` — normalized contracts, validation/freshness gates, spatial interpolation, simulator, SQLite session store, event detection, and loopback server.
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
npm start
```

Open http://127.0.0.1:4173/.

The server is loopback-only by default. It starts a deterministic simulator with nine positioned channel sources and exposes `/api/health`, `/api/state`, `/api/adapters`, `/api/adapter-runtime`, `/api/calibrations`, `/api/transforms`, scene/source authoring, HTTP observation ingestion, `/ws/live` live updates, `/ws/ingest` normalized observation input, session recording, historical/recomputed/determinism replay, session comparison, and privacy-labelled JSON export.

## Implemented v0.1 slice

The current engineering tranche is runnable now: deterministic simulator, normalized observation contracts, provider-manifest admission, explicit evidence/privacy classes, provenance edges, versioned calibration records, explicit spatial support geometry, revisioned transforms, separate field value/support outputs, revision-gated field candidates, append-only hash-chain session journal, versioned adapter frames, permission-gated adapter lifecycle and quarantine, loopback Host/Origin and bounded WebSocket checks, loopback API/WebSocket live updates, bounded ordered ingress, duplicate admission rejection, inbound WebSocket and JSON-lines adapter modules, adapter discovery, 2D scene renderer, inverse-distance visual fields, a weighted Unified activity layer, bounded activity-change events, quality/freshness gates, diagnostics, scene-frame editing, draggable source calibration, manual source creation and numeric observation injection, immutable per-session scene/source/calibration/transform snapshots, historical session export, independent session verification, SQLite recording/replay data, JSON export/import controls, local session deletion, and automated tests.

Replay is explicit about truth: `/api/sessions/:id/replay?mode=historical` returns retained recorded artifacts from the frozen session snapshot, `mode=recompute` returns a derived activity field, and `mode=determinism` compares two recomputations. `POST /api/sessions/compare` produces a derived difference artifact between two self-contained sessions. `/api/sessions/:id/receipt` and `npm run receipt:session -- path/to/exported-session.json` produce a replay receipt with an evidence level, digests, counts, and explicit software-only limitations. Open sessions are marked `interrupted` after a process restart and are never resumed or silently completed.

Native hardware adapters, richer calibration, optional encrypted export, and desktop packaging remain follow-on work described in the build specification. The SQLite store is local and dependency-free on supported Node.js releases; it migrates an existing `data/sidechannel.json` file on first startup.

See the build specification for the authoritative requirements.
