export const ADAPTERS = Object.freeze([
  {
    type: 'simulator',
    name: 'Deterministic simulator',
    description: 'Built-in seeded source for demos and repeatable tests.',
    capabilities: ['positioned_observations', 'multi_channel'],
    privacyMode: 'local_numeric'
  },
  {
    type: 'manual',
    name: 'Manual source',
    description: 'A user-created source that accepts explicit numeric observations.',
    capabilities: ['manual_observation'],
    privacyMode: 'local_numeric'
  },
  {
    type: 'jsonl',
    name: 'JSON-lines adapter',
    description: 'Reads versioned normalized observations line by line.',
    capabilities: ['normalized_observation'],
    privacyMode: 'local_numeric'
  },
  {
    type: 'websocket',
    name: 'Local WebSocket adapter',
    description: 'Accepts normalized observations over loopback at /ws/ingest.',
    capabilities: ['streaming_observation'],
    privacyMode: 'local_numeric'
  },
  {
    type: 'subprocess',
    name: 'Supervised subprocess adapter',
    description: 'Runs a local versioned JSONL provider with bounded output and cancellation.',
    capabilities: ['versioned_frames', 'bounded_output', 'cancellation'],
    privacyMode: 'provider_declared'
  }
]);

export function listAdapters() {
  return ADAPTERS.map((adapter) => ({ ...adapter, capabilities: adapter.capabilities.slice() }));
}

export function getAdapter(type) {
  const adapter = ADAPTERS.find((item) => item.type === type);
  return adapter ? { ...adapter, capabilities: adapter.capabilities.slice() } : null;
}
