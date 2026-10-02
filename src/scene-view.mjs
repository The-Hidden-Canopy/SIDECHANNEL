export const SCENE_VIEW_FORMAT = 'sidechannel.scene-view/1';

export const DEFAULT_SCENE_VIEW_LIMITS = Object.freeze({
  maxSources: 256,
  maxObservations: 512,
  maxEvents: 40,
  maxDiagnostics: 40,
  maxAdapters: 64
});

function boundedLimit(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, maximum);
}

function providerIdForSource(source) {
  return source?.providerManifest?.providerId || (source?.adapterType === 'simulator' ? 'builtin:simulator' : null);
}

function healthForSource(observation, adapter) {
  if (adapter?.state === 'QUARANTINED') return 'quarantined';
  if (adapter && adapter.state !== 'RUNNING') return 'disconnected';
  if (observation?.status === 'stale') return 'stale';
  if (observation) return 'live';
  return 'waiting';
}

function recentItems(items, limit, compare = null) {
  const values = Array.isArray(items) ? items.slice() : [];
  if (compare) values.sort(compare);
  return values.slice(-limit);
}

export function createSceneView({
  scene,
  observations = [],
  events = [],
  diagnostics = [],
  adapterRuntime = [],
  recording = null,
  nowMs = Date.now(),
  limits = {}
} = {}) {
  const resolvedLimits = {
    maxSources: boundedLimit(limits.maxSources, DEFAULT_SCENE_VIEW_LIMITS.maxSources, DEFAULT_SCENE_VIEW_LIMITS.maxSources),
    maxObservations: boundedLimit(limits.maxObservations, DEFAULT_SCENE_VIEW_LIMITS.maxObservations, DEFAULT_SCENE_VIEW_LIMITS.maxObservations),
    maxEvents: boundedLimit(limits.maxEvents, DEFAULT_SCENE_VIEW_LIMITS.maxEvents, DEFAULT_SCENE_VIEW_LIMITS.maxEvents),
    maxDiagnostics: boundedLimit(limits.maxDiagnostics, DEFAULT_SCENE_VIEW_LIMITS.maxDiagnostics, DEFAULT_SCENE_VIEW_LIMITS.maxDiagnostics),
    maxAdapters: boundedLimit(limits.maxAdapters, DEFAULT_SCENE_VIEW_LIMITS.maxAdapters, DEFAULT_SCENE_VIEW_LIMITS.maxAdapters)
  };
  const sourceList = Array.isArray(scene?.sources) ? scene.sources : [];
  const runtimeList = Array.isArray(adapterRuntime) ? adapterRuntime : [];
  const currentObservations = recentItems(observations, resolvedLimits.maxObservations, (left, right) =>
    Number(left?.timestampMs || 0) - Number(right?.timestampMs || 0)
  );
  const observationBySource = new Map();
  for (const observation of currentObservations) {
    if (observation?.sourceId) observationBySource.set(observation.sourceId, observation);
  }
  const adapterByProvider = new Map(runtimeList.map((adapter) => [adapter?.manifest?.providerId, adapter]));
  const boundedSources = sourceList.slice(0, resolvedLimits.maxSources);
  const sourceProjections = boundedSources.map((source) => {
    const providerId = providerIdForSource(source);
    const adapter = providerId ? adapterByProvider.get(providerId) : null;
    const observation = observationBySource.get(source.id) || null;
    return {
      id: source.id,
      name: source.name,
      adapterType: source.adapterType,
      channels: Array.isArray(source.channels) ? source.channels.slice(0, 32) : [],
      providerId,
      position: source.position || null,
      health: healthForSource(observation, adapter),
      observationId: observation?.id || null,
      observationTimestampMs: observation?.timestampMs || null,
      observationStatus: observation?.status || null
    };
  });
  const boundedAdapters = runtimeList.slice(0, resolvedLimits.maxAdapters);
  const boundedEvents = recentItems(events, resolvedLimits.maxEvents);
  const boundedDiagnostics = recentItems(diagnostics, resolvedLimits.maxDiagnostics);
  return {
    format: SCENE_VIEW_FORMAT,
    formatVersion: 1,
    generatedAtMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
    scene: scene ? { ...scene, sources: boundedSources } : null,
    sourceProjections,
    observations: currentObservations,
    events: boundedEvents,
    diagnostics: boundedDiagnostics,
    adapterRuntime: boundedAdapters,
    recording,
    limits: resolvedLimits,
    summary: {
      sourceCount: sourceList.length,
      boundedSourceCount: boundedSources.length,
      observationCount: Array.isArray(observations) ? observations.length : 0,
      boundedObservationCount: currentObservations.length,
      eventCount: Array.isArray(events) ? events.length : 0,
      diagnosticCount: Array.isArray(diagnostics) ? diagnostics.length : 0
    }
  };
}
