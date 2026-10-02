# SIDECHANNEL build and packaging runbook

This repository is the hardware-independent local application tranche. It runs as a loopback web app and is intentionally usable before any physical sensor adapter exists.

## Supported runtime

- Node.js 22 or newer with the built-in `node:sqlite` module available.
- No npm dependency installation is required for the current build.
- The server binds to `127.0.0.1` by default. Set `PORT` to choose another local port.

## Build verification

Run the single verification command from the repository root:

```text
npm run verify
```

It syntax-checks every `src/*.mjs` file and the browser module, then runs the complete Node test suite.

After exporting a session, verify its independent receipt with `npm run verify:session -- path/to/exported-session.json`. The running server also exposes `/api/sessions/:id/verify` for the same structural and snapshot checks.

Session exports include an append-only journal with per-session sequence numbers and a SHA-256 hash chain. Verification reports a journal-tail failure if any retained event payload, order, or digest has been altered.

## Local run

```text
npm start
```

Open `http://127.0.0.1:4173/`. The application starts with deterministic simulated sources, supports scene/source authoring, manual numeric input, JSON-lines and WebSocket ingestion, recording, replay, export/import, and local deletion.

## Runtime data

The server creates `data/sidechannel.sqlite` plus SQLite WAL files. `data/` is ignored by Git. If a legacy `data/sidechannel.json` exists and the SQLite file does not, the first startup migrates scenes, sessions, observations, and events without deleting the legacy file. New sessions freeze their scene, source registry, calibration summary, and transform snapshot so later live edits do not rewrite historical export meaning.

## Portable packaging boundary

A future desktop wrapper may bundle the repository files, a supported Node runtime, and a user-writable data directory. The wrapper must preserve these boundaries:

- keep the HTTP server loopback-only unless a deliberate security review changes the contract;
- keep raw audio, network payloads, and persistent device identities disabled by default;
- keep physical sensor adapters outside the simulator acceptance path;
- run `npm run verify` before shipping a bundle;
- treat hardware capability, deployment, and production readiness as separate gates from local tests.

No native hardware driver or desktop shell is included in this tranche.
