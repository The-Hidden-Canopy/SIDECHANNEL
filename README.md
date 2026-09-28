# SIDECHANNEL

SIDECHANNEL is a local-first spatial sensing explorer for making incidental emissions visible in one shared scene. It is designed to bring RF, magnetic field, heat, vibration, sound features, network rates, electrical load, Bluetooth aggregates, and light flicker into a common coordinate system.

## Current repository contents

- `outputs/SIDECHANNEL_BUILD_SPEC.md` — product plan, engineering specification, data contracts, architecture, milestones, and Codex execution brief.
- `src/` — normalized contracts, validation/freshness gates, spatial interpolation, simulator, JSON session store, and loopback server.
- `public/` — responsive 2D scene explorer with channel layers, source health, inspector, diagnostics, recording, replay, and export controls.
- `test/` — deterministic simulator, validation, freshness, spatial field, and activity-fusion tests.
- `package.json` — Node.js project manifest.

## Safety and privacy boundaries

The intended implementation is loopback-only and local-first. It must not store raw audio, network payloads, or persistent device identities by default, and it must not provide physical actuation or imply that correlation proves causality.

## Run locally

Requirements: Node.js 22 or newer. No dependency installation is required for the current slice.

```text
npm test
npm start
```

Open http://127.0.0.1:4173/.

The server is loopback-only by default. It starts a deterministic simulator with nine positioned channel sources and exposes `/api/health`, `/api/state`, observation ingestion, local WebSocket live updates, session recording, replay data, and privacy-labelled JSON export.

## Implemented v0.1 slice

The first engineering slice is runnable now: deterministic simulator, normalized observation contracts, loopback API/WebSocket live updates, 2D scene renderer, inverse-distance visual fields, quality/freshness gates, diagnostics, session recording/replay data, JSON export/import support, and automated tests.

Native hardware adapters, richer calibration, SQLite persistence, and desktop packaging remain follow-on work described in the build specification.

See the build specification for the authoritative requirements.
