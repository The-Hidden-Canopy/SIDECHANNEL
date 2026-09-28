# SIDECHANNEL

SIDECHANNEL is a local-first spatial sensing explorer for making incidental emissions visible in one shared scene. It is designed to bring RF, magnetic field, heat, vibration, sound features, network rates, electrical load, Bluetooth aggregates, and light flicker into a common coordinate system.

## Current repository contents

- `outputs/SIDECHANNEL_BUILD_SPEC.md` — product plan, engineering specification, data contracts, architecture, milestones, and Codex execution brief.
- `package.json` — initial Node.js project manifest for the v0.1 implementation.

## Safety and privacy boundaries

The intended implementation is loopback-only and local-first. It must not store raw audio, network payloads, or persistent device identities by default, and it must not provide physical actuation or imply that correlation proves causality.

## Build direction

The next implementation slice is the v0.1 local scene explorer: deterministic simulator, normalized observation contracts, loopback API/WebSocket ingestion, 2D scene renderer, quality gates, session recording/replay, and tests.

See the build specification for the authoritative requirements.
