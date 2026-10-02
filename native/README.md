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
```

The same project also works with an NMake generator when the active developer environment exposes `cl.exe` and `nmake.exe`.

After building, compare the C++ fixture to the Node reference simulator:

```text
npm run verify:native-parity -- build/native/native/Debug/sidechannel-native.exe 2
```

The native CLI supports both human-readable summary/CSV output and a dependency-free structured JSON fixture. The parity command compares that JSON fixture's canonical schema identifier, fixture IDs, source/channel identity, timestamps, values, quality scores, and simulated evidence state. It does not yet prove SQLite/export parity.

This is not yet the native authority or a parity-complete export engine. SQLite persistence, local IPC, schema serialization, and semantic export equivalence remain explicit follow-on gates. No hardware adapter is included.
