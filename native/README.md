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
```

The same project also works with an NMake generator when the active developer environment exposes `cl.exe` and `nmake.exe`.

This is not yet the native authority or a parity-complete export engine. SQLite persistence, local IPC, schema serialization, and semantic export equivalence remain explicit follow-on gates. No hardware adapter is included.
