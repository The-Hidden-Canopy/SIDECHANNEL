import { CHANNELS } from './contracts.mjs';

export const DEFAULT_SOURCES = Object.freeze([
  {
    id: 'sim_rf',
    name: 'RF field',
    adapterType: 'simulator',
    channels: ['rf'],
    capabilities: ['band_energy'],
    unit: 'dBm',
    range: [-120, 0],
    freshnessWindowMs: 1200,
    privacyMode: 'local_numeric',
    connected: true,
    position: { x: 1.1, y: 1.0, uncertaintyRadius: 0.35 }
  },
  {
    id: 'sim_magnetic',
    name: 'Magnetic field',
    adapterType: 'simulator',
    channels: ['magnetic'],
    capabilities: ['magnitude'],
    unit: 'uT',
    range: [0, 200],
    freshnessWindowMs: 1200,
    privacyMode: 'local_numeric',
    connected: true,
    position: { x: 3.8, y: 1.0, uncertaintyRadius: 0.3 }
  },
  {
    id: 'sim_heat',
    name: 'Thermal field',
    adapterType: 'simulator',
    channels: ['heat'],
    capabilities: ['temperature'],
    unit: 'C',
    range: [-20, 80],
    freshnessWindowMs: 1800,
    privacyMode: 'local_numeric',
    connected: true,
    position: { x: 0.9, y: 3.3, uncertaintyRadius: 0.5 }
  },
  {
    id: 'sim_vibration',
    name: 'Vibration pad',
    adapterType: 'simulator',
    channels: ['vibration'],
    capabilities: ['rms', 'peak'],
    unit: 'g',
    range: [0, 1],
    freshnessWindowMs: 1000,
    privacyMode: 'summary_only',
    connected: true,
    position: { x: 2.4, y: 2.5, uncertaintyRadius: 0.25 }
  },
  {
    id: 'sim_sound',
    name: 'Sound features',
    adapterType: 'simulator',
    channels: ['sound'],
    capabilities: ['band_energy', 'onset'],
    unit: 'normalized',
    range: [0, 1],
    freshnessWindowMs: 1000,
    privacyMode: 'raw_disabled',
    connected: true,
    position: { x: 4.3, y: 3.3, uncertaintyRadius: 0.7 }
  },
  {
    id: 'sim_network',
    name: 'Network rate',
    adapterType: 'simulator',
    channels: ['network'],
    capabilities: ['bytes_per_second'],
    unit: 'bytes/s',
    range: [0, 100000],
    freshnessWindowMs: 1500,
    privacyMode: 'summary_only',
    connected: true,
    position: { x: 3.8, y: 2.1, uncertaintyRadius: 0.4 }
  },
  {
    id: 'sim_electrical',
    name: 'Electrical load',
    adapterType: 'simulator',
    channels: ['electrical'],
    capabilities: ['watts'],
    unit: 'W',
    range: [0, 5000],
    freshnessWindowMs: 1500,
    privacyMode: 'local_numeric',
    connected: true,
    position: { x: 0.6, y: 1.4, uncertaintyRadius: 0.3 }
  },
  {
    id: 'sim_bluetooth',
    name: 'Bluetooth aggregate',
    adapterType: 'simulator',
    channels: ['bluetooth'],
    capabilities: ['aggregate_count'],
    unit: 'devices',
    range: [0, 100],
    freshnessWindowMs: 2200,
    privacyMode: 'summary_only',
    connected: true,
    position: { x: 2.0, y: 3.8, uncertaintyRadius: 0.9 }
  },
  {
    id: 'sim_light',
    name: 'Light flicker',
    adapterType: 'simulator',
    channels: ['light_flicker'],
    capabilities: ['modulation_depth', 'dominant_frequency'],
    unit: 'normalized',
    range: [0, 1],
    freshnessWindowMs: 1200,
    privacyMode: 'local_numeric',
    connected: true,
    position: { x: 4.4, y: 0.6, uncertaintyRadius: 0.4 }
  }
]);

export function createDefaultScene() {
  return {
    id: 'scene_main',
    name: 'Main room',
    schemaVersion: '0.1',
    width: 5,
    height: 4,
    unit: 'm',
    sources: DEFAULT_SOURCES.map((source) => ({ ...source, position: { ...source.position } })),
    placements: DEFAULT_SOURCES.map((source) => ({
      sourceId: source.id,
      position: { ...source.position },
      calibrationState: 'calibrated',
      calibratedAtMs: Date.now()
    }))
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function createSimulator({ emit, sources = DEFAULT_SOURCES, clock = () => Date.now(), intervalMs = 250, seed = 1337 }) {
  const random = mulberry32(seed);
  let timer = null;
  let tick = 0;

  function emitTick() {
    const timestampMs = clock();
    const observations = [];
    sources.forEach((source, index) => {
      const range = source.range;
      const wave = 0.5 + 0.5 * Math.sin(tick * 0.18 + index * 0.91);
      const pulse = 0.5 + 0.5 * Math.sin(tick * 0.047 + index * 1.7);
      const jitter = (random() - 0.5) * 0.06;
      const normalized = Math.min(0.98, Math.max(0.02, 0.18 + 0.62 * wave + 0.18 * pulse + jitter));
      const value = range[0] + (range[1] - range[0]) * normalized;
      const observation = {
        schema: 'sidechannel.observation/2',
        schemaVersion: '0.1',
        id: source.id + '_' + tick,
        sourceId: source.id,
        channel: source.channels[0],
        timestampMs,
        receivedAtMs: timestampMs,
        value: Number(value.toFixed(4)),
        unit: source.unit,
        status: 'measured',
        quality: {
          score: Number((0.88 + random() * 0.11).toFixed(3)),
          state: 'good',
          reasons: []
        },
        position: { ...source.position },
        feature: source.capabilities[0],
        metadata: { scenario: 'deterministic-room', seed }
      };
      observations.push(observation);
      emit(observation);
    });
    tick += 1;
    return observations;
  }

  return {
    start() {
      if (timer) return;
      emitTick();
      timer = setInterval(emitTick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get tick() {
      return tick;
    },
    step() {
      return emitTick();
    },
    channels: CHANNELS.slice()
  };
}
