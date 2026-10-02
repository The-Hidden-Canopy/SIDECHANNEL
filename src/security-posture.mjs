export const SECURITY_POSTURE = Object.freeze([
  {
    id: 'loopback-binding',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'The HTTP server binds to 127.0.0.1 by default.'
  },
  {
    id: 'host-origin-allowlist',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'HTTP and WebSocket requests accept only configured loopback Host and Origin values.'
  },
  {
    id: 'launch-token-authorization',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'State-changing HTTP requests and WebSocket ingestion require the current process launch token.'
  },
  {
    id: 'bounded-transport',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'WebSocket clients, frame buffers, control frames, and ingest rates are bounded.'
  },
  {
    id: 'privacy-admission',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'Raw content and persistent identity fields fail closed unless explicitly declared, and retained exports reject prohibited fields.'
  },
  {
    id: 'package-integrity',
    status: 'enforced',
    evidenceLevel: 'E1',
    control: 'Session imports and exports verify snapshot, package, journal, schema, and retained-reference integrity.'
  },
  {
    id: 'physical-actuation',
    status: 'not-supported',
    evidenceLevel: 'E0',
    control: 'This runtime observes and derives; it does not issue physical actuation commands.'
  },
  {
    id: 'deployment-hardening',
    status: 'external-gate',
    evidenceLevel: 'E0',
    control: 'OS hardening, installer signing, firewall posture, account policy, and deployment review remain outside this repository.'
  },
  {
    id: 'consent-regulatory-review',
    status: 'external-gate',
    evidenceLevel: 'E0',
    control: 'Consent, legal, regulatory, safety, and hardware accuracy review are not established by software tests.'
  }
]);

export function securityPostureSnapshot() {
  return {
    format: 'sidechannel-security-posture',
    formatVersion: '0.1',
    scope: 'local-software',
    claims: SECURITY_POSTURE.map((claim) => ({ ...claim }))
  };
}
