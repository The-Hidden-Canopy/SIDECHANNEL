# Native reference-core slice

This directory is the first C++23 native-core slice from the docuseries. It implements two hardware-independent contracts:

- a seeded nine-channel deterministic simulator;
- a bounded admission sequencer with backpressure receipt counters.

Build and test from the repository root with a C++23-capable CMake generator:

```text
cmake -S . -B build/native -G "Visual Studio 18 2026"
cmake --build build/native --config Debug
ctest --test-dir build/native -C Debug --output-on-failure
build/native/native/Debug/sidechannel-native.exe --ticks 2
build/native/native/Debug/sidechannel-native.exe --ticks 2 --json
build/native/native/Debug/sidechannel-native.exe --ticks 2 --session-json
```

The same project also works with an NMake generator when the active developer environment exposes `cl.exe` and `nmake.exe`.

After building, compare the C++ fixture to the Node reference simulator:

```text
npm run verify:native-parity -- build/native/native/Debug/sidechannel-native.exe 2
```

The native CLI supports both human-readable summary/CSV output and a dependency-free structured JSON fixture. The parity command compares that JSON fixture's canonical schema identifier, fixture IDs, source/channel identity, timestamps, values, quality scores, and simulated evidence state. It does not yet prove SQLite/export parity.

`--session-json` emits a dependency-free `sidechannel-session/0.2` reference package with a frozen native scene/source snapshot, canonical observations, SHA-256 snapshot and package digests, a hash-chained session/observation journal, and bounded empty pose/event sections. Run `npm run verify:native-session -- path/to/sidechannel-native.exe 2` to validate that package with the Node session verifier and compare canonical observation rows against the Node deterministic simulator. This proves semantic fixture-package parity, digest, and journal compatibility; it is not native SQLite persistence or a replacement for the Node runtime authority.

The native core also exposes a file-backed `NativeSessionStore` and the CLI's `--session-file PATH` mode. It writes an append-only `SIDECHANNEL_NATIVE_SESSION/1` record containing hash-chained runtime events and encoded observation rows, marks an unclosed file as interrupted on the next open, replays retained observations from disk, and verifies journal and observation parity before reporting a receipt. Re-running `--session-file` on a completed file verifies/replays it without appending a second recording. This is a hardware-independent native persistence/replay foundation; SQLite, local IPC, desktop packaging, and physical adapters remain separate gates.

The CLI's `--ipc-stdio TOKEN [--session-file PATH]` mode provides a bounded local process boundary using `sidechannel.native-ipc/1` tab-delimited, hex-encoded frames. It authenticates every frame with the supplied process token, rejects malformed, oversized, or mismatched frames, and supports `ping`, `status`, and `shutdown` responses. When a session file is attached, `session.status`, `session.observe`, `session.verify`, and `session.close` bind the process boundary to the native journal. Observation payloads use the bounded pipe form `id|sourceId|channel|timestampMs|value|qualityScore|evidenceState`; the daemon reopens and verifies the same file on a later invocation. This is a local transport/contract receipt, not a network listener, privileged authorization system, or deployment security result.

`sidechannel/c_api.h` exposes the native control surface as an opaque-handle C ABI: open/append/close/verify/state for a native session and bounded IPC-frame encoding. The ABI copies caller data into the native store, validates finite values and bounded quality, and never exposes internal pointers. It is a software interoperability boundary, not a hardware driver API or a security/permission grant.

The native core can build the bounded `sidechannel.scene-view/1` projection directly from admitted observations. It preserves separate observation records and source-health projections, applies hard source/observation limits, and serializes the same presentation-oriented contract used by the browser path. This native projection has no hardware adapter, scene authoring, or renderer authority of its own.

This is not yet the native authority or a parity-complete export engine. SQLite persistence, native desktop shell integration, and physical adapter integration remain explicit follow-on gates. No hardware adapter is included.
