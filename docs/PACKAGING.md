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

The complete suite includes an isolated loopback process smoke test. It starts the server on a temporary port with `SIDECHANNEL_DATA_DIR` pointed at a temporary directory, confirms the live WebSocket's initial and reconnect snapshots plus simulator stop/start behavior, sends a masked normalized observation through authenticated `/ws/ingest`, checks its acknowledgement and live broadcast, confirms the browser render-budget module is served from the public asset boundary, exercises launch-token admission, source creation, HTTP observation ingestion, recording, export, independent package verification, export/import relabelling, historical replay, and imported-session deletion, then removes the temporary data. Normal runs continue to use the local `data/` directory.

`npm run package:audit` emits a deterministic `sidechannel-runtime-manifest/1` JSON manifest for the future desktop bundle. It hashes the Node loopback entrypoint, all `src/*.mjs` runtime modules, all public browser assets, and the operator-facing package notes. The manifest explicitly excludes mutable runtime state (`data/`), build/deployment output, dependency caches, Git metadata, and the native reference tree. This is a packaging boundary audit, not an installer, signing result, deployment approval, or hardware claim.

`npm run package:runtime -- . path/to/new-output` assembles the manifest files into a fresh portable loopback bundle, writes `sidechannel-runtime-manifest.json`, and rechecks every copied file's byte count and SHA-256 digest. The command refuses an existing output directory so it cannot silently overwrite a prior artifact. The result still requires a supported Node runtime and remains local-first; installer generation, signing, native desktop identity, deployment approval, and hardware support are separate gates.

`npm run verify:runtime-bundle -- . path/to/output` launches an already assembled bundle as a separate process, waits for the supervised `sidechannel-portable-host/1` ready receipt, checks `/api/health` for the loopback contract, checks the browser shell, and shuts the host down. If no output path is supplied, the command assembles a temporary bundle first. This is an artifact-launch smoke gate, not an installer, signing, native desktop, deployment, or hardware result.

The hardware-independent C++23 reference slice has its own CTest gate. From a Visual Studio Developer Command Prompt, configure the root CMake project with a C++23 generator, then run `cmake --build <build-dir>` and `ctest --test-dir <build-dir> --output-on-failure`. It verifies deterministic simulation, bounded admission, manifest-gated adapter lifecycle/quarantine, file-backed and SQLite journal/recovery, C ABI bounds, and bounded SceneView projection; the Node commands below additionally verify native session and export parity.

`.github/workflows/verify.yml` runs the Node reference suite, portable bundle assembly, S0–S4 benchmark matrix, SceneView and burst benchmark receipts, and software fault campaign on every push/pull request. It also runs the native CTest plus Node↔C++ parity gate on Ubuntu and Windows, plus a separate Ubuntu native AddressSanitizer/UndefinedBehaviorSanitizer CTest gate with `SIDECHANNEL_NATIVE_SANITIZERS=ON`. These CI jobs verify software behavior only; they do not validate physical hardware, deployment, or regulated operation. The sanitizer gate is compiler/runtime-specific CI evidence and is not a substitute for production-platform qualification.

When the native executable is built, `npm run verify:native-parity -- path/to/sidechannel-native.exe 2` compares its deterministic fixture rows with the Node reference for schema identifier, identity, channel, timestamp, value, quality, and evidence state.
The native reference CLI also supports `--session-json`; `npm run verify:native-session -- path/to/sidechannel-native.exe 2` runs that dependency-free package through the Node session verifier and checks canonical observation shape, frozen snapshot/package digests, reference integrity, and semantic observation-row parity against the Node deterministic simulator. This is fixture-package compatibility, not native SQLite authority, local IPC, or hardware evidence.

The native reference also supports `--session-file PATH`. This software-only path persists hash-chained runtime events and encoded observation rows, reopens completed files for replay/verification, and marks an unclosed file as `interrupted` after restart. Add `--export-json PATH` to a completed `--session-file` run to materialize a Node-verifiable `sidechannel-session/0.2` package; interrupted sessions are refused so their state is not overstated. Its receipt proves native file-backed journal/replay/export behavior only; it is not native SQLite authority, a desktop shell, or hardware evidence.

The native reference also supports `--sqlite-session-file PATH`. This backend vendors SQLite 3.45.2, enables WAL/full synchronous commits, stores each admitted observation and its journal event in one transaction, recovers open sessions as `interrupted`, and supports `--export-json PATH`. Run `npm run verify:native-sqlite -- path/to/sidechannel-native.exe 2` to verify creation, reopen, package digest, journal integrity, and Node semantic parity. This is software-only native SQLite evidence, not desktop packaging, deployment approval, or hardware evidence.

Run `npm run verify:native-roundtrip -- path/to/sidechannel-native.exe 2` to export a completed native file-backed session, independently verify the package, import it into a fresh reference SQLite authority, and check observation-count parity, `imported` evidence relabelling, `imported_from` provenance, and `ImportAccepted` journaling. This closes a cross-runtime software roundtrip; it does not prove physical measurement accuracy or deployment compatibility.

Run `npm run benchmark:native -- path/to/sidechannel-native.exe 8 --output native-benchmark.json` for a bounded E2 native benchmark receipt. It exercises creation/close and reopen/replay for both the file-backed and SQLite/WAL authorities, records host-local process timings and package sizes, independently verifies each exported package with the Node session verifier, and emits a tamper-detectable receipt. `npm run verify:native-benchmark -- native-benchmark.json` independently checks the saved receipt digest, bounds, backend coverage, and limitation labels without rerunning the native executable. The measurements are comparative software evidence only; they are not production capacity, deployment, hardware, or regulated-operation claims.

The native CLI's `--ipc-stdio TOKEN [--session-file PATH|--sqlite-session-file PATH]` mode exposes a bounded `sidechannel.native-ipc/1` local process contract with token admission and `ping`, `status`, `scene.view`, `session.export`, and `shutdown` commands. `scene.view` returns a bounded `sidechannel.scene-view/1` projection from the attached session and accepts only bounded `maxSources|maxObservations` limits. `session.export` returns a completed package only when its serialized JSON fits the IPC payload bound; the direct CLI and C ABI provide larger explicit output buffers. It also exposes bounded adapter-supervisor commands for registration, listing, permission grant/revoke, start/stop, failure recording, and explicit quarantine clearing. With either session backend attached, successful adapter mutations are hash-chained into the same journal as `session.status`, `session.observe`, `session.verify`, and `session.close`; observations use the pipe payload `id|sourceId|channel|timestampMs|value|qualityScore|evidenceState`, and a later process invocation reopens and verifies the same backend. `npm run verify:native-ipc-sqlite -- path/to/sidechannel-native.exe` checks the SQLite-backed IPC path, `npm run verify:native-ipc-scene-view -- path/to/sidechannel-native.exe` checks the projection against both backends and rejects invalid limits, and `npm run verify:native-ipc-export -- path/to/sidechannel-native.exe` independently verifies packages returned by both backends. It is intentionally stdio-based and does not claim a network service, operating-system permission authority, installer security, or hardware support.

The native `sidechannel/c_api.h` surface provides opaque-handle file-backed and SQLite-backed session control (`sidechannel_session_open` and `sidechannel_session_open_sqlite`), bounded `sidechannel.scene-view/1` and completed-session package export, and bounded IPC-frame encoding without exposing native pointers. Its tests cover both backends' open/append/close/reopen/verify/scene-view/export paths, invalid quality rejection, invalid scene limits, completed-session export refusal, and output-buffer bounds. This is an interoperability contract only; deployment permissions and physical adapters remain separate gates.

The native reference can also serialize a bounded `sidechannel.scene-view/1` projection from admitted observations. Source-health projections, observation evidence status, deterministic ordering, and truncation limits remain presentation metadata; the browser/native renderer, scene authoring, hardware adapters, and VANTA remain separate consumers or gates.

Run `npm run benchmark -- 8 14` for a software-only E2 simulator receipt covering admitted/rejected counts, admission p50/p95/p99, field evaluation time, throughput, replay determinism, and explicit non-production limitations. The same check is available as `POST /api/benchmark` and through the UI's Runtime evidence panel. Use `npm run verify:benchmark -- path/to/benchmark-receipt.json` to independently verify a saved receipt and detect digest or count tampering.

Run `npm run benchmark:scene-view -- 20 9` or call `POST /api/benchmark/scene-view` for a bounded E2 SceneView receipt covering update serialization latency and payload-size p50/p95/p99/max metrics. The Runtime evidence panel exposes the same check. These measurements are host-local simulator evidence; they do not establish production capacity, deployment readiness, or physical-source performance.

Run `npm run faults` or use the Runtime evidence panel's fault campaign action for a repeatable E2 software receipt covering stale publication rejection, out-of-order detector protection, malformed and oversized adapter frames, range rejection, permission revocation, journal tampering, invalid spatial geometry, and privacy-sensitive field rejection. The same bounded check is available as `POST /api/verification/faults`; its receipt is tamper-detectable and its limitations remain software-only.
Run `npm run benchmark:matrix` for bounded generated-source S0–S3 profiles (8, 32, 128, and 512 sources) plus the S4-burst profile. `npm run benchmark:burst -- 10000 8 1024` runs that burst directly with a bounded ingress queue. These are comparative software measurements only; the burst output explicitly disclaims a 10,000-frames-per-second production capacity claim.
The runtime also exposes a read-only capability matrix at `/api/capabilities`; the UI's Capability gates panel keeps implemented, reference-only, hardware-gated, planned, and unsupported claims visibly separate.

`GET /api/security-posture` exposes the local threat/privacy boundary as a machine-readable, read-only matrix. Enforced entries cover loopback binding, request authorization, bounded transport, privacy admission, and package integrity. External deployment, consent, regulatory, operating-system, and hardware-accuracy gates remain explicitly separate.

The loopback WebSocket layer keeps control traffic separate from JSON observations: masked client ping frames receive bounded pong frames, close frames are acknowledged, and fragmented/oversized/unsupported control frames receive a protocol close. Text ingestion remains bounded by frame bytes, buffering, and rate limits.

After exporting a session, verify its independent receipt with `npm run verify:session -- path/to/exported-session.json`. Exported packages include a package-level SHA-256 digest, while snapshot and journal digests remain separately checked. Generate a replay evidence receipt with `npm run receipt:session -- path/to/exported-session.json`. The running server also exposes `/api/sessions/:id/verify` and `/api/sessions/:id/receipt` for the same structural checks and software-only replay receipt.

Session exports include an append-only journal with per-session sequence numbers and a SHA-256 hash chain. Verification reports a journal-tail failure if any retained event payload, order, or digest has been altered. Replay is split into historical view, recompute, and determinism verification: recorded artifacts are never labelled as current estimator output, and derived comparison fields retain their source session IDs and estimator configuration.

Admitted observations carry the canonical `sidechannel.observation/2` identifier while accepting legacy `schemaVersion: 0.1` provider frames. New session snapshots use the named schema-set digest exported by `src/schema.mjs`.

Session import runs the same independent verification before writing SQLite state. A package with a broken snapshot digest, duplicate/out-of-order observations, prohibited privacy flag, retained sensitive observation fields, invalid scene background, or corrupted journal tail is rejected with its verification report. The verifier reports `privacyRetentionVerified` separately so a package cannot bypass the live-ingestion sanitizer through import. A terminal session can also be copied through `POST /api/sessions/:id/copy`; the route verifies the source first, creates a new local ID through the import boundary, and labels observations `imported`. Recording sessions are refused so a live capture cannot be silently cloned as completed evidence.

The verifier also checks observation schema validity and retained references: observation sources must exist in the frozen source registry, calibration references must exist in the frozen calibration registry, derived-input provenance must point to another retained observation, and pose references must resolve to retained pose samples. This is package integrity, not proof that the referenced physical measurement was accurate.

Accepted imports receive a new local session ID, and each imported observation is relabelled `imported` with the original session ID and an `imported_from` provenance edge. Imported evidence cannot masquerade as a live local measurement.

## Local run

```text
npm start
```

Open `http://127.0.0.1:4173/`. The application starts with deterministic simulated sources, supports scene/source authoring, manual numeric input, JSON-lines and WebSocket ingestion, recording, replay, export/import, local deletion, and loopback adapter-supervisor lifecycle controls. The supervised subprocess adapter is a tested local transport primitive with bounded JSONL frames, stdout limits, cancellation, and supervisor integration; it does not provide or imply a native hardware driver.

For a supervised portable launch, run `npm run start:portable -- --port 4173 --data-dir path/to/data`. The host starts the loopback server as a child process, waits for a healthy `/api/health` response, prints a `sidechannel-portable-host/1` ready receipt, and forwards `SIGINT`/`SIGTERM` shutdown. It is still a Node-based local host; no installer, signing, native desktop shell, deployment approval, or hardware authority is implied.

While a session is recording, adapter failures are emitted as bounded diagnostics and journaled as `AdapterFailure`; crossing the quarantine threshold adds `AdapterQuarantined`. The runtime does not synthesize a zero-valued observation for a failed provider.

For the built-in simulator, entering `QUARANTINED` also stops the simulator emission loop and changes the source health projection to `quarantined`; clearing quarantine leaves the provider disabled until an explicit start. Adapter lifecycle changes are broadcast to the live workspace so source health does not depend on a stale observation snapshot.

## Runtime data

The server creates `data/sidechannel.sqlite` plus SQLite WAL files. `data/` is ignored by Git. If a legacy `data/sidechannel.json` exists and the SQLite file does not, the first startup migrates scenes, sessions, observations, and events without deleting the legacy file. New sessions freeze their scene, source registry, calibration summary, and transform snapshot so later live edits do not rewrite historical export meaning. Observations are returned in admitted row order, not timestamp order. A session left open by a process restart is retained as `interrupted` with a `process_restart` reason; it is not eligible for new observations or normal completion.

Calibration reuse is fail-closed. A calibration record used by an observation must be valid, unexpired, and bound to the current provider digest, runtime-derived source-profile digest, and transform revision. When a known source is named during publication, the server derives those identities from the current source and transform graph and rejects caller-supplied mismatches. Source-profile digests cover measurement identity and policy fields, while placement is governed by the spatial transform graph; changing the transform revision invalidates new use without silently mutating historical observations. `GET /api/calibrations/:id/compatibility?providerDigest=...&sourceProfileDigest=...` returns the explicit compatibility decision against the current transform revision; observations carrying an incompatible or unbound `calibrationRef` are rejected with the decision and reasons. This proves software enforcement of provenance, not physical calibration accuracy.

Provider identity is authoritative when a source has a registered provider manifest. A normalized frame may omit identity fields and inherit the registered manifest, but it may not claim a different provider id or digest. Sources without a manifest remain explicitly less bound and are not hardware evidence.

Privacy admission is fail-closed. Raw audio/network payload fields and persistent device identity fields are rejected unless the provider manifest explicitly opts in and the observation declares `raw_retained_explicit`; even then, sensitive values are never copied into normalized observation metadata. The retained metadata records bounded `privacyOmittedFields` markers so an inspector can explain what was removed. This is a local software boundary, not a claim of legal compliance or a substitute for deployment-specific consent review.

The source authoring form exposes `local_numeric`, `summary_only`, and `raw_disabled` privacy modes, and the scene-source API rejects undeclared modes or privacy classes. The source list and evidence inspector show the selected source mode, privacy class, provider raw-content policy, source-identity policy, and any omitted-field markers. These labels make the declared boundary inspectable; they do not grant a provider permission to retain prohibited data.

The UI also exposes a text alternative for the current scene and visible layers, makes source rows keyboard-selectable, preserves visible focus outlines, uses shape/pattern cues alongside channel colors, and honors `prefers-reduced-motion`. This is an accessibility aid for the local software surface, not a claim that canvas rendering alone satisfies every deployment accessibility requirement.

Permission revocation is an active boundary: `POST /api/adapter-runtime/:providerId/revoke` removes the selected grants (or all grants when omitted), records a bounded cancellation reason, and asks a supervised subprocess to stop. The provider remains disabled until permissions are explicitly granted again; this is local process supervision, not a claim that an external hardware device has been powered down.

While a session is recording, scene/source revisions, observation rejections, calibration publication/invalidation, transform publication, pose samples, provider start/stop, and permission grant/revocation are appended as bounded hash-chained runtime events. Source revision payloads are sanitized before journaling and can extend the frozen source registry for package verification. A live API mutation without an active recording session changes current state only; it is not retroactively inserted into a historical session.

Pose history is bounded and explicit. `POST /api/poses` records a `sidechannel.pose/1` sample for a registered source; an observation from a `pose_required` source without a direct position resolves to the nearest sample within `poseMaxAgeMs`, records `poseRef`, `poseFrameId`, and `poseDistanceMs`, and adds a provenance edge. Missing or stale pose resolution rejects the observation instead of inventing a position. This is software spatial resolution, not hardware localization accuracy.

When a pose-resolved observation is admitted into a recording, the referenced pose sample is copied into that session's bounded SQLite evidence set and JSON export. Session verification validates retained pose shape, uniqueness, source/frame correspondence, and every observation `poseRef`; a package with a missing pose parent is rejected as non-self-contained.

Spatial evaluation preserves support geometry. `RegionSupport` is sampled across a bounded center/cardinal footprint, `PathSupport` across its bounded trajectory points, `EllipseSupport` and `VolumeSupport` across bounded projected footprints, and `RaySupport`, `ConeSupport`, and `FrustumSupport` across bounded directional samples. `UnknownSupport` contributes no spatial samples. Field artifacts report both observation count and support sample count/types. Unsupported or malformed geometry is rejected instead of silently becoming a point. Directional and volume supports are software 2D projections; they do not establish depth, beam shape, or hardware localization accuracy.

The live inspector is an evidence-explainability surface, not a decorative tooltip. Selecting an observation shows its source and provider identities, provider digest, value/unit, evidence and quality state, timestamp/age, position, support type, pose reference and resolution distance, calibration reference, source-profile digest, transform revision, sequence, input observation IDs, provenance edges, privacy class, and processing path. Runtime-provided values are escaped before rendering. This makes the software's lineage visible without implying physical sensing accuracy.

The session toolbar exposes the same independent verifier used by import. Selecting a local session and choosing `Verify` reports package, snapshot, journal, source/calibration/provenance reference, pose, and observation checks in the UI; a green result is evidence of package integrity only, not hardware validation or production readiness.

`POST /api/sessions/prune` requires an explicit `confirm: true` and bounded `keep` count. It deletes only older terminal sessions, protects active recordings, returns deleted IDs and remaining session summaries, and never prunes an open recording. This is local retention management; it does not establish backup, archival, deployment, or regulatory guarantees.

The workspace exposes two derived comparison paths. The two-session `Compare` action calls the bounded recompute comparison path and labels the result `DERIVED difference`, including changed-cell and maximum intensity/support deltas. During replay, `Pin A`, `Pin B`, and `Compare A/B` call `/api/sessions/compare-time` to compare two retained times from one session. Both artifacts retain source session IDs, estimator configuration, and temporal bounds; neither is presented as a new measurement.

`POST /api/evaluation/cooccurrence` produces a bounded derived artifact from the current live observations or a retained `sessionId`. It buckets normalized channel changes, reports same-direction strength/support and a bounded lag estimate, retains input observation IDs, and optionally restricts analysis to a scene rectangle. The artifact explicitly says co-occurrence is not causal evidence; it does not identify a device, decode content, or establish physical localization.

`POST /api/evaluation/adaptive-field` produces a bounded adaptive 2D field from live or retained observations. It starts with a coarse tile grid, refines only high-variation tiles, enforces a hard tile budget, and returns separate value/support outputs plus input lineage. This is an estimator and presentation optimization; it is not depth sensing, physical localization, or a production-scale capacity claim.

`POST /api/evaluation/field-graph` emits a deterministic evaluation receipt for a selected channel. The receipt records observation selection, spatial resolution, estimation, confidence separation, and publication-gate nodes with dependency/output digests. `estimatorId` may select the bounded `idw.baseline`, `nearest-source`, `kernel.gaussian`, `temporal-decay`, `region.constant`, or `vector.magnitude` path through `estimatorOptions`. A changed revision returns `candidate_rejected_stale` with a retained candidate digest and no published artifact.

Replay also exposes bounded temporal evidence markers. Activity-change events use the activity marker style; retained runtime-journal mutations such as calibration, transform, provider, permission, rejection, and session-boundary entries use the journal marker style. Selecting a marker moves the replay cursor to that retained timestamp. This is historical navigation over the session package, not a new measurement or proof that a physical mutation occurred outside the recorded runtime.

The live workspace can pause its presentation without stopping ingestion or recording. While `Pause view` is active, accepted observations and detected events continue updating client state and the server-side session; the canvas and event presentation resume from the latest retained state when the operator chooses `Resume view`. This is a view-control behavior, not a backpressure or acquisition pause guarantee.

The Layers panel independently toggles the unified activity field, each channel field, support/confidence rendering, uncertainty geometry, replay trails, and activity-event pulses. Support changes visual opacity only; it never changes the underlying field value. Geometry and trail overlays are bounded to the retained observation/session data and remain software-derived evidence.

The layer panel exposes the live estimator's inverse-distance power and search radius. Power is bounded to 0.5–6; a zero radius means unlimited search, while a positive radius masks cells with no contributing support and leaves them `insufficient_data`. These controls affect the local presentation estimator only and are not physical localization or triangulation claims.

The unified activity panel exposes a bounded weight from 0 to 2 for each channel. A zero weight excludes that channel from the derived unified field while leaving channel fields, admitted observations, provenance, and recorded sessions unchanged. These are presentation-estimator weights, not claims that channels share a calibrated physical unit.

The workspace can collect a bounded local baseline window from valid source channels and render a signed, capped z-score anomaly-relative overlay. Red indicates values above the captured baseline and blue indicates values below it. The baseline stores normalized channel statistics in browser memory only; it is not a new observation, is not included in session exports, and is cleared when switching between live and replay views. This is a derived presentation aid, not an anomaly diagnosis or causal inference.

The canvas applies a deterministic client-side render budget based on valid observation count. Ordinary scenes retain the full field grid and overlay detail; denser scenes reduce field resolution first, then trail and event-overlay limits, while preserving point observations and source-health markers. A visible warning and accessible status summary identify the active tier. This is graceful presentation degradation, not data loss, acquisition backpressure, or a production capacity claim.

The canvas also offers bounded 2D/12°/24° camera-tilt presentation modes. Tilt is a rendering transform only: source placement, pointer hit-testing, ruler measurements, and evidence coordinates remain authoritative in the unprojected 2D scene frame. It is pseudo-3D presentation, not depth sensing, camera calibration, or physical localization.

The spatial frame panel can create and activate multiple bounded local scenes. Activation restarts only the hardware-independent simulator for the selected scene, clears the live observation view, and leaves recorded session packages unchanged. Scene switching is an explicit local workspace transition; it does not imply physical room detection, automatic localization, or multi-room hardware coverage.

The live client requests `/api/state?view=compact` whenever the loopback WebSocket opens, including after a disconnect/reconnect. The compact snapshot carries the active scene, bounded current observations, diagnostics/events, scene directory, sessions, recording state, and fresh launch token without requiring a browser refresh. This is local reconnect behavior, not a claim of adapter transport continuity or hardware availability.

The explicit `sidechannel.scene-view/1` contract is available at `/api/scene-view` and is also used for live reconnect refreshes. It bounds source projections, current observations, events, diagnostics, and adapter runtime entries for presentation; the response carries truncation limits and summary counts so a renderer can distinguish a bounded view from a complete session package. Historical detail remains available through session/replay routes.

Source rows consume runtime adapter events and expose explicit `live`, `stale`, `waiting`, `disconnected`, or `quarantined` health states. A disconnected simulator is not presented as live solely because a previous observation remains fresh; adapter state is an independent runtime signal.

Layer controls are also grouped into Signals, Evidence overlays, and Scene context. Group actions change only the child visibility flags; the individual layer checkboxes remain authoritative and can be changed afterward. Grouping is a presentation convenience and does not alter admitted observations, field values, support, or historical session packages.

Source marks expose calibration and age semantics as separate toggles. Uncalibrated or expired source placement uses a dashed amber ring, stale observations retain their value but receive an explicit stale ring and age label, and inferred or derived observations use a diamond marker. These are visual evidence-state cues only; they do not upgrade measurement quality or turn inference into a physical measurement.

Scenes also support bounded room/zone polygons. The workspace creates rectangle-backed polygons in scene coordinates, the loopback API validates that points stay inside the frame, and the region list can remove them. Regions are part of the scene snapshot, so historical session packages retain the floor-plan structure that was authoritative when recording began.

The scene editor exposes the coordinate unit (`m`, `ft`, or `px`) and a one-shot measurement ruler. A measured segment is rendered and reported in the selected scene unit; it is a view aid only and does not rewrite observation values, provider identity, calibration lineage, or historical session data.

Scenes also support bounded door/portal segments. The workspace validates endpoints inside the scene, preserves an open/closed state and optional room references in the scene snapshot, and renders doors as solid segments and portals as dashed segments. This is spatial authoring metadata, not a claim that a physical door or passage was detected.

The spatial-frame panel also publishes explicit transform revisions through the loopback API. Each edge records its source and destination frames, translation, rotation, scale, and revision; direct and indirect frame cycles, overlong frame names, invalid numeric values, and graph overflow fail closed. The graph resolves bounded acyclic multi-edge paths and the workspace lists the current edges so an operator can see which software frame relationships were published. These edges are versioned runtime metadata and do not establish physical calibration accuracy; hardware adapters, external calibration instruments, and invertibility beyond the bounded graph contract remain separate gates.

The same panel can import one bounded local PNG, JPEG, or WebP data URL as a scene background. Its scene-space rectangle, rotation, and opacity are validated and persisted with the scene snapshot, then rendered beneath the grid and evidence layers. Remote URLs are rejected, and the background is presentation context only; it does not become an observation, provider, calibration, or hardware claim.

Optional encrypted portability is available through the `Encrypted export` workspace action and the `POST /api/sessions/:id/export` route. The envelope uses bounded scrypt parameters and AES-256-GCM; the passphrase is not stored. Import decrypts only after authentication and sends the resulting package through the same independent session verifier as plaintext import. Encryption protects the exported file in transit/storage; it does not prove hardware accuracy, regulate deployment, or replace user-controlled passphrase retention.

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
