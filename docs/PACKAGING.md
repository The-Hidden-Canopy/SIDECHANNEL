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

`.github/workflows/verify.yml` runs the Node reference suite on every push/pull request and runs the native CTest plus Node↔C++ parity gate on Ubuntu and Windows. These CI jobs verify software behavior only; they do not validate physical hardware, deployment, or regulated operation.

When the native executable is built, `npm run verify:native-parity -- path/to/sidechannel-native.exe 2` compares its deterministic fixture rows with the Node reference for schema identifier, identity, channel, timestamp, value, quality, and evidence state.
The native reference CLI also supports `--session-json`; `npm run verify:native-session -- path/to/sidechannel-native.exe 2` runs that dependency-free package through the Node session verifier and checks canonical observation shape, frozen snapshot digest, and reference integrity. This is semantic fixture compatibility, not native SQLite authority, local IPC, or hardware evidence.

Run `npm run benchmark -- 8 14` for a software-only E2 simulator receipt covering admitted/rejected counts, admission p50/p95/p99, field evaluation time, throughput, replay determinism, and explicit non-production limitations. The same check is available as `POST /api/benchmark` and through the UI's Runtime evidence panel. Use `npm run verify:benchmark -- path/to/benchmark-receipt.json` to independently verify a saved receipt and detect digest or count tampering.
Run `npm run benchmark:matrix` for bounded generated-source S0–S3 profiles (8, 32, 128, and 512 sources) plus the S4-burst profile. `npm run benchmark:burst -- 10000 8 1024` runs that burst directly with a bounded ingress queue. These are comparative software measurements only; the burst output explicitly disclaims a 10,000-frames-per-second production capacity claim.
The runtime also exposes a read-only capability matrix at `/api/capabilities`; the UI's Capability gates panel keeps implemented, reference-only, hardware-gated, planned, and unsupported claims visibly separate.

The loopback WebSocket layer keeps control traffic separate from JSON observations: masked client ping frames receive bounded pong frames, close frames are acknowledged, and fragmented/oversized/unsupported control frames receive a protocol close. Text ingestion remains bounded by frame bytes, buffering, and rate limits.

After exporting a session, verify its independent receipt with `npm run verify:session -- path/to/exported-session.json`. Exported packages include a package-level SHA-256 digest, while snapshot and journal digests remain separately checked. Generate a replay evidence receipt with `npm run receipt:session -- path/to/exported-session.json`. The running server also exposes `/api/sessions/:id/verify` and `/api/sessions/:id/receipt` for the same structural checks and software-only replay receipt.

Session exports include an append-only journal with per-session sequence numbers and a SHA-256 hash chain. Verification reports a journal-tail failure if any retained event payload, order, or digest has been altered. Replay is split into historical view, recompute, and determinism verification: recorded artifacts are never labelled as current estimator output, and derived comparison fields retain their source session IDs and estimator configuration.

Admitted observations carry the canonical `sidechannel.observation/2` identifier while accepting legacy `schemaVersion: 0.1` provider frames. New session snapshots use the named schema-set digest exported by `src/schema.mjs`.

Session import runs the same independent verification before writing SQLite state. A package with a broken snapshot digest, duplicate/out-of-order observations, prohibited privacy flag, or corrupted journal tail is rejected with its verification report.

The verifier also checks observation schema validity and retained references: observation sources must exist in the frozen source registry, calibration references must exist in the frozen calibration registry, derived-input provenance must point to another retained observation, and pose references must resolve to retained pose samples. This is package integrity, not proof that the referenced physical measurement was accurate.

Accepted imports receive a new local session ID, and each imported observation is relabelled `imported` with the original session ID and an `imported_from` provenance edge. Imported evidence cannot masquerade as a live local measurement.

## Local run

```text
npm start
```

Open `http://127.0.0.1:4173/`. The application starts with deterministic simulated sources, supports scene/source authoring, manual numeric input, JSON-lines and WebSocket ingestion, recording, replay, export/import, local deletion, and loopback adapter-supervisor lifecycle controls. The supervised subprocess adapter is a tested local transport primitive with bounded JSONL frames, stdout limits, cancellation, and supervisor integration; it does not provide or imply a native hardware driver.

While a session is recording, adapter failures are emitted as bounded diagnostics and journaled as `AdapterFailure`; crossing the quarantine threshold adds `AdapterQuarantined`. The runtime does not synthesize a zero-valued observation for a failed provider.

## Runtime data

The server creates `data/sidechannel.sqlite` plus SQLite WAL files. `data/` is ignored by Git. If a legacy `data/sidechannel.json` exists and the SQLite file does not, the first startup migrates scenes, sessions, observations, and events without deleting the legacy file. New sessions freeze their scene, source registry, calibration summary, and transform snapshot so later live edits do not rewrite historical export meaning. Observations are returned in admitted row order, not timestamp order. A session left open by a process restart is retained as `interrupted` with a `process_restart` reason; it is not eligible for new observations or normal completion.

Calibration reuse is fail-closed. A calibration record used by an observation must be valid, unexpired, and bound to the current provider digest, runtime-derived source-profile digest, and transform revision. When a known source is named during publication, the server derives those identities from the current source and transform graph and rejects caller-supplied mismatches. Source-profile digests cover measurement identity and policy fields, while placement is governed by the spatial transform graph; changing the transform revision invalidates new use without silently mutating historical observations. `GET /api/calibrations/:id/compatibility?providerDigest=...&sourceProfileDigest=...` returns the explicit compatibility decision against the current transform revision; observations carrying an incompatible or unbound `calibrationRef` are rejected with the decision and reasons. This proves software enforcement of provenance, not physical calibration accuracy.

Provider identity is authoritative when a source has a registered provider manifest. A normalized frame may omit identity fields and inherit the registered manifest, but it may not claim a different provider id or digest. Sources without a manifest remain explicitly less bound and are not hardware evidence.

Permission revocation is an active boundary: `POST /api/adapter-runtime/:providerId/revoke` removes the selected grants (or all grants when omitted), records a bounded cancellation reason, and asks a supervised subprocess to stop. The provider remains disabled until permissions are explicitly granted again; this is local process supervision, not a claim that an external hardware device has been powered down.

While a session is recording, scene/source revisions, observation rejections, calibration publication/invalidation, transform publication, pose samples, provider start/stop, and permission grant/revocation are appended as bounded hash-chained runtime events. Source revision payloads are sanitized before journaling and can extend the frozen source registry for package verification. A live API mutation without an active recording session changes current state only; it is not retroactively inserted into a historical session.

Pose history is bounded and explicit. `POST /api/poses` records a `sidechannel.pose/1` sample for a registered source; an observation from a `pose_required` source without a direct position resolves to the nearest sample within `poseMaxAgeMs`, records `poseRef`, `poseFrameId`, and `poseDistanceMs`, and adds a provenance edge. Missing or stale pose resolution rejects the observation instead of inventing a position. This is software spatial resolution, not hardware localization accuracy.

When a pose-resolved observation is admitted into a recording, the referenced pose sample is copied into that session's bounded SQLite evidence set and JSON export. Session verification validates retained pose shape, uniqueness, source/frame correspondence, and every observation `poseRef`; a package with a missing pose parent is rejected as non-self-contained.

Spatial evaluation preserves support geometry. `RegionSupport` is sampled across a bounded center/cardinal footprint, `PathSupport` across its bounded trajectory points, and `EllipseSupport` across a bounded perimeter sample set; field artifacts report both observation count and support sample count/types. Unsupported or malformed geometry is rejected instead of silently becoming a point.

The live inspector is an evidence-explainability surface, not a decorative tooltip. Selecting an observation shows its source and provider identities, provider digest, value/unit, evidence and quality state, timestamp/age, position, support type, pose reference and resolution distance, calibration reference, source-profile digest, transform revision, sequence, input observation IDs, provenance edges, privacy class, and processing path. Runtime-provided values are escaped before rendering. This makes the software's lineage visible without implying physical sensing accuracy.

The session toolbar exposes the same independent verifier used by import. Selecting a local session and choosing `Verify` reports package, snapshot, journal, source/calibration/provenance reference, pose, and observation checks in the UI; a green result is evidence of package integrity only, not hardware validation or production readiness.

The workspace also exposes a two-session `Compare` action. It calls the bounded recompute comparison path and labels the result `DERIVED difference`, including changed-cell and maximum intensity/support deltas; comparison output retains both source session IDs and estimator provenance and is never presented as a new measurement.

Replay also exposes bounded temporal evidence markers. Activity-change events use the activity marker style; retained runtime-journal mutations such as calibration, transform, provider, permission, rejection, and session-boundary entries use the journal marker style. Selecting a marker moves the replay cursor to that retained timestamp. This is historical navigation over the session package, not a new measurement or proof that a physical mutation occurred outside the recorded runtime.

The Layers panel independently toggles the unified activity field, each channel field, support/confidence rendering, uncertainty geometry, replay trails, and activity-event pulses. Support changes visual opacity only; it never changes the underlying field value. Geometry and trail overlays are bounded to the retained observation/session data and remain software-derived evidence.

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
