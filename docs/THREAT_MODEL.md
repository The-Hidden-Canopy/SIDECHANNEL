# SIDECHANNEL threat and privacy posture

This is a bounded review of the hardware-independent local runtime. It describes software controls that are implemented and tested; it is not a penetration test, deployment approval, consent determination, safety case, or regulatory assessment.

## Security boundary

The runtime is a loopback web application. The process owns a temporary launch token, persists local SQLite session state, accepts normalized observations, and serves a browser UI. Physical adapters, operating-system permissions, installer signing, firewall configuration, cloud deployment, and external identities are outside this tranche.

## Threat/control matrix

| Threat or failure mode | Runtime control | Evidence |
| --- | --- | --- |
| A remote host reaches the local API | Bind to `127.0.0.1`; validate Host and Origin for HTTP/WebSocket requests | `test/security.test.mjs`; `src/security.mjs` |
| A same-host page changes runtime state without authorization | Require the process launch token on state-changing HTTP requests and `/ws/ingest` | `test/security.test.mjs`; `test/server-smoke.test.mjs` |
| A client exhausts transport memory or connection capacity | Bound client counts, frame sizes, buffers, control frames, and rate windows | `test/websocket.test.mjs`; `test/server-smoke.test.mjs`; `src/server.mjs` |
| Raw audio, network payloads, or persistent device IDs enter retained evidence by default | Privacy admission rejects undeclared sensitive fields; normalization omits explicitly permitted sensitive values; package verification rejects retained sensitive fields | `test/privacy.test.mjs`; `test/validation.test.mjs`; `test/session-verifier.test.mjs` |
| Imported evidence is treated as live local measurement | Import relabels observations as imported and retains package provenance | `test/sqlite-store.test.mjs`; `src/sqlite-store.mjs` |
| A session package is altered after export | Snapshot, package digest, journal chain, schema, observation, pose, and reference checks fail closed | `test/session-verifier.test.mjs`; `test/journal.test.mjs` |
| A provider fails or is revoked | Adapter state, bounded failure counts, quarantine, cancellation, and diagnostic/journal paths are retained | `test/adapter-runtime.test.mjs`; `test/subprocess-adapter.test.mjs` |
| Software output is mistaken for physical proof | Evidence classes, provenance, calibration gates, capability statuses, and explicit derived labels remain visible | `src/capabilities.mjs`; `docs/PACKAGING.md` |

## Explicit exclusions

This posture does not prove hardware accuracy, physical localization, secure deployment, user consent, privacy-law compliance, regulated operation, or resistance to a compromised host operating system. The runtime has no physical actuation path and no cloud authority.

The machine-readable equivalent is available from `GET /api/security-posture` and `src/security-posture.mjs`. Its `enforced` entries describe local software controls; `external-gate` entries are intentionally not promoted to implementation claims.
