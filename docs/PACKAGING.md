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

The hardware-independent C++23 reference slice has its own CTest gate. From a Visual Studio Developer Command Prompt, configure the root CMake project with a C++23 generator, then run `cmake --build <build-dir>` and `ctest --test-dir <build-dir> --output-on-failure`. It currently verifies deterministic simulation and bounded admission only; it is not yet native persistence or export parity.

When the native executable is built, `npm run verify:native-parity -- path/to/sidechannel-native.exe 2` compares its deterministic fixture rows with the Node reference for schema identifier, identity, channel, timestamp, value, quality, and evidence state.

Run `npm run benchmark -- 8 14` for a software-only E2 simulator receipt covering admitted/rejected counts, admission p50/p95/p99, field evaluation time, throughput, replay determinism, and explicit non-production limitations. The same check is available as `POST /api/benchmark` and through the UI's Runtime evidence panel. Use `npm run verify:benchmark -- path/to/benchmark-receipt.json` to independently verify a saved receipt and detect digest or count tampering.
Run `npm run benchmark:matrix` for bounded generated-source S0–S3 profiles (8, 32, 128, and 512 sources) plus the S4-burst profile. `npm run benchmark:burst -- 10000 8 1024` runs that burst directly with a bounded ingress queue. These are comparative software measurements only; the burst output explicitly disclaims a 10,000-frames-per-second production capacity claim.
The runtime also exposes a read-only capability matrix at `/api/capabilities`; the UI's Capability gates panel keeps implemented, reference-only, hardware-gated, planned, and unsupported claims visibly separate.

After exporting a session, verify its independent receipt with `npm run verify:session -- path/to/exported-session.json`. Generate a replay evidence receipt with `npm run receipt:session -- path/to/exported-session.json`. The running server also exposes `/api/sessions/:id/verify` and `/api/sessions/:id/receipt` for the same structural checks and software-only replay receipt.

Session exports include an append-only journal with per-session sequence numbers and a SHA-256 hash chain. Verification reports a journal-tail failure if any retained event payload, order, or digest has been altered. Replay is split into historical view, recompute, and determinism verification: recorded artifacts are never labelled as current estimator output, and derived comparison fields retain their source session IDs and estimator configuration.

Admitted observations carry the canonical `sidechannel.observation/2` identifier while accepting legacy `schemaVersion: 0.1` provider frames. New session snapshots use the named schema-set digest exported by `src/schema.mjs`.

Session import runs the same independent verification before writing SQLite state. A package with a broken snapshot digest, duplicate/out-of-order observations, prohibited privacy flag, or corrupted journal tail is rejected with its verification report.

Accepted imports receive a new local session ID, and each imported observation is relabelled `imported` with the original session ID and an `imported_from` provenance edge. Imported evidence cannot masquerade as a live local measurement.

## Local run

```text
npm start
```

Open `http://127.0.0.1:4173/`. The application starts with deterministic simulated sources, supports scene/source authoring, manual numeric input, JSON-lines and WebSocket ingestion, recording, replay, export/import, local deletion, and loopback adapter-supervisor lifecycle controls. The supervised subprocess adapter is a tested local transport primitive with bounded JSONL frames, stdout limits, cancellation, and supervisor integration; it does not provide or imply a native hardware driver.

While a session is recording, adapter failures are emitted as bounded diagnostics and journaled as `AdapterFailure`; crossing the quarantine threshold adds `AdapterQuarantined`. The runtime does not synthesize a zero-valued observation for a failed provider.

## Runtime data

The server creates `data/sidechannel.sqlite` plus SQLite WAL files. `data/` is ignored by Git. If a legacy `data/sidechannel.json` exists and the SQLite file does not, the first startup migrates scenes, sessions, observations, and events without deleting the legacy file. New sessions freeze their scene, source registry, calibration summary, and transform snapshot so later live edits do not rewrite historical export meaning. Observations are returned in admitted row order, not timestamp order. A session left open by a process restart is retained as `interrupted` with a `process_restart` reason; it is not eligible for new observations or normal completion.

## Portable packaging boundary

A future desktop wrapper may bundle the repository files, a supported Node runtime, and a user-writable data directory. The wrapper must preserve these boundaries:

- keep the HTTP server loopback-only unless a deliberate security review changes the contract;
- preserve the process-scoped launch token for all state-changing HTTP calls and `/ws/ingest` connections;
- keep Host/Origin validation, WebSocket client limits, frame-size limits, and per-connection rate limits enabled;
- keep raw audio, network payloads, and persistent device identities disabled by default;
- keep physical sensor adapters outside the simulator acceptance path;
- run `npm run verify` before shipping a bundle;
- treat hardware capability, deployment, and production readiness as separate gates from local tests.

No native hardware driver or desktop shell is included in this tranche.
