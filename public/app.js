import { baselineDelta, createBaselineIndex, createBaselineSnapshot, latestValidObservations } from './baseline.mjs';

const CHANNELS = [
  ['rf', 'RF', '#6ce4db', 220],
  ['magnetic', 'Magnetic field', '#79a7ff', 210],
  ['heat', 'Heat', '#ffb47b', 28],
  ['vibration', 'Vibration', '#cf9cff', 280],
  ['sound', 'Sound features', '#ff8f97', 350],
  ['network', 'Network rate', '#7de1ff', 170],
  ['electrical', 'Electrical load', '#ffd166', 45],
  ['bluetooth', 'Bluetooth aggregate', '#a9e88b', 125],
  ['light_flicker', 'Light flicker', '#f49dff', 320]
];
const DISPLAY_LAYERS = [
  ['activity', 'Unified activity', '#d7fff7', 0],
  ...CHANNELS,
  ['support', 'Support / confidence', '#6ce4db', 0],
  ['uncertainty', 'Uncertainty geometry', '#ffb47b', 0],
  ['trails', 'Temporal trails', '#79a7ff', 0],
  ['events', 'Activity event pulses', '#ff8f97', 0],
  ['calibration', 'Calibration state', '#ffb47b', 0],
  ['age', 'Data age', '#ff8f97', 0],
  ['baseline', 'Baseline delta', '#ff8f97', 0],
  ['background', 'Imported background', '#79a7ff', 0],
  ['zones', 'Rooms / zones', '#a9e88b', 0],
  ['portals', 'Doors / portals', '#ffd166', 0]
];
const LAYER_GROUPS = [
  { id: 'signals', label: 'Signals', layers: ['activity', ...CHANNELS.map((channel) => channel[0])] },
  { id: 'evidence', label: 'Evidence overlays', layers: ['support', 'uncertainty', 'trails', 'events', 'calibration', 'age', 'baseline'] },
  { id: 'scene', label: 'Scene context', layers: ['background', 'zones', 'portals'] }
];
const JOURNAL_MARKER_TYPES = new Set([
  'SessionOpened', 'SessionClosed', 'CalibrationPublished', 'CalibrationInvalidated',
  'TransformRevisionPublished', 'PoseSampleRecorded', 'ProviderStarted', 'ProviderStopped',
  'PermissionGranted', 'PermissionRevoked', 'AdapterFailure', 'AdapterQuarantined',
  'SceneRevisionPublished', 'SourceRevisionPublished', 'ObservationRejected', 'ImportAccepted'
]);
const JOURNAL_MARKER_LABELS = {
  SessionOpened: 'session opened',
  SessionClosed: 'session closed',
  CalibrationPublished: 'calibration published',
  CalibrationInvalidated: 'calibration invalidated',
  TransformRevisionPublished: 'transform revision',
  PoseSampleRecorded: 'pose sample',
  ProviderStarted: 'provider started',
  ProviderStopped: 'provider stopped',
  PermissionGranted: 'permission granted',
  PermissionRevoked: 'permission revoked',
  AdapterFailure: 'adapter failure',
  AdapterQuarantined: 'adapter quarantined',
  SceneRevisionPublished: 'scene revision',
  SourceRevisionPublished: 'source revision',
  ObservationRejected: 'observation rejected',
  ImportAccepted: 'import accepted'
};
const RANGES = {
  rf: [-120, 0], magnetic: [0, 200], heat: [-20, 80], vibration: [0, 1],
  sound: [0, 1], network: [0, 100000], electrical: [0, 5000], bluetooth: [0, 100], light_flicker: [0, 1]
};

const state = {
  scene: null,
  observations: [],
  diagnostics: [],
  events: [],
  recording: null,
  scenes: [],
  sessions: [],
  transforms: { revision: 0, edges: [] },
  backgroundImageKey: null,
  backgroundImage: null,
  replay: null,
  replayArtifact: null,
  replayReport: null,
  sessionVerification: null,
  verificationBusy: false,
  comparison: null,
  comparisonBusy: false,
  temporalPins: { a: null, b: null },
  temporalComparison: null,
  temporalComparisonBusy: false,
  replayMode: 'historical',
  viewPaused: false,
  fieldSettings: { power: 2, radius: 0 },
  baseline: null,
  baselineCapture: null,
  cameraTiltDeg: 0,
  capabilities: null,
  benchmarkReceipt: null,
  benchmarkBusy: false,
  burstReceipt: null,
  burstBusy: false,
  selected: null,
  editMode: false,
  draggedSourceId: null,
  measureMode: false,
  measuring: false,
  measureStart: null,
  measureEnd: null,
  suppressNextCanvasClick: false,
  visible: Object.fromEntries(DISPLAY_LAYERS.map((item) => [item[0], true]))
};

let launchToken = null;

const canvas = document.getElementById('sceneCanvas');
const context = canvas.getContext('2d');
const layerPanel = document.getElementById('layerPanel');
const sourceList = document.getElementById('sourceList');
const canvasEmpty = document.getElementById('canvasEmpty');

function api(path, options) {
  const request = { ...(options || {}) };
  const method = String(request.method || 'GET').toUpperCase();
  request.headers = { ...(request.headers || {}) };
  if (method !== 'GET' && launchToken) request.headers['x-sidechannel-launch-token'] = launchToken;
  return fetch(path, request).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  });
}

function refreshLiveState() {
  return api('/api/state?view=compact').then(hydrate);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function sourceById(id) {
  return state.scene?.sources.find((source) => source.id === id);
}

function normalize(channel, value) {
  const numeric = Array.isArray(value)
    ? Math.sqrt(value.reduce((sum, item) => sum + item * item, 0))
    : Number(value);
  const range = RANGES[channel] || [0, 1];
  return Math.max(0, Math.min(1, (numeric - range[0]) / (range[1] - range[0])));
}

function activeObservations() {
  if (!state.replay) return state.observations;
  const max = state.replayTime;
  return state.replay.observations.filter((observation) => observation.timestampMs <= max);
}

function hydrate(payload) {
  state.scene = payload.scene;
  state.observations = payload.observations || [];
  state.diagnostics = payload.diagnostics || [];
  state.events = payload.events || [];
  state.recording = payload.recording;
  state.scenes = payload.scenes || state.scenes;
  state.sessions = payload.sessions || [];
  state.transforms = payload.transforms || state.transforms;
  state.capabilities = payload.capabilities || state.capabilities;
  launchToken = payload.server?.launchToken || launchToken;
  syncBackgroundImage();
  render();
}

function renderSceneTools() {
  if (!state.scene) return;
  const sceneSelect = document.getElementById('sceneSelect');
  const activateSceneButton = document.getElementById('activateSceneButton');
  const sceneSwitchHint = document.getElementById('sceneSwitchHint');
  if (sceneSelect && activateSceneButton && sceneSwitchHint) {
    const scenes = state.scenes.length ? state.scenes : [state.scene];
    sceneSelect.innerHTML = scenes.map((scene) => '<option value="' + escapeHtml(scene.id) + '">' + escapeHtml(scene.name || scene.id) + '</option>').join('');
    sceneSelect.value = state.scene.id;
    activateSceneButton.disabled = true;
    sceneSwitchHint.textContent = scenes.length > 1
      ? scenes.length + ' local scenes available. Switching clears only the live view; recorded sessions remain intact.'
      : 'Create another local scene to move between rooms without changing recorded sessions.';
  }
  const width = document.getElementById('sceneWidth');
  const height = document.getElementById('sceneHeight');
  const unit = document.getElementById('sceneUnit');
  if (document.activeElement !== width) width.value = state.scene.width;
  if (document.activeElement !== height) height.value = state.scene.height;
  if (document.activeElement !== unit) unit.value = state.scene.unit || 'm';
  const calibration = (state.scene.sources || []).every((source) => source.calibrationState !== 'uncalibrated');
  document.getElementById('calibrationState').textContent = calibration ? 'calibrated' : 'needs calibration';
  document.getElementById('editSceneButton').textContent = state.editMode ? 'Exit editor' : 'Edit scene';
  document.getElementById('editSceneButton').classList.toggle('edit-active', state.editMode);
  document.getElementById('editHint').textContent = state.editMode
    ? 'Drag a source marker, then release to save its calibrated position.'
    : 'Turn on Edit scene, then drag source markers to calibrate placement.';
  canvas.classList.toggle('canvas-editing', state.editMode);
  const measureButton = document.getElementById('measureButton');
  measureButton.textContent = state.measureMode ? 'Cancel measurement' : 'Measure distance';
  measureButton.classList.toggle('edit-active', state.measureMode);
  const readout = document.getElementById('measureReadout');
  if (!state.measureMode && !state.measureStart) readout.textContent = 'Ruler is idle.';
  else if (state.measureStart && state.measureEnd) {
    readout.textContent = 'Distance · ' + Math.hypot(state.measureEnd.x - state.measureStart.x, state.measureEnd.y - state.measureStart.y).toFixed(2) + ' ' + (state.scene.unit || 'm');
  } else readout.textContent = 'Click and drag across the scene to measure.';
}

function renderRegions() {
  const list = document.getElementById('regionList');
  if (!list) return;
  const regions = state.scene?.regions || [];
  if (!regions.length) {
    list.innerHTML = '<span class="muted">No rooms or zones defined.</span>';
    return;
  }
  list.innerHTML = regions.map((region) =>
    '<div class="region-entry"><span><strong>' + escapeHtml(region.name) + '</strong> · ' +
    escapeHtml(region.kind || 'zone') + ' · ' + region.points.length + ' points</span>' +
    '<button class="button small ghost" type="button" data-delete-region="' + escapeHtml(region.id) + '">Remove</button></div>'
  ).join('');
  list.querySelectorAll('[data-delete-region]').forEach((button) => {
    button.addEventListener('click', async () => {
      const regionId = button.dataset.deleteRegion;
      try {
        await api('/api/scenes/' + state.scene.id + '/regions/' + encodeURIComponent(regionId), { method: 'DELETE' });
        hydrate(await api('/api/state'));
      } catch (error) {
        document.getElementById('freshnessLabel').textContent = 'Region removal failed: ' + error.message;
      }
    });
  });
}

function renderPortals() {
  const list = document.getElementById('portalList');
  if (!list) return;
  const portals = state.scene?.portals || [];
  if (!portals.length) {
    list.innerHTML = '<span class="muted">No doors or portals defined.</span>';
    return;
  }
  list.innerHTML = portals.map((portal) =>
    '<div class="region-entry"><span><strong>' + escapeHtml(portal.name) + '</strong> · ' +
    escapeHtml(portal.kind || 'portal') + (portal.open === false ? ' · closed' : ' · open') + '</span>' +
    '<button class="button small ghost" type="button" data-delete-portal="' + escapeHtml(portal.id) + '">Remove</button></div>'
  ).join('');
  list.querySelectorAll('[data-delete-portal]').forEach((button) => {
    button.addEventListener('click', async () => {
      const portalId = button.dataset.deletePortal;
      try {
        await api('/api/scenes/' + state.scene.id + '/portals/' + encodeURIComponent(portalId), { method: 'DELETE' });
        hydrate(await api('/api/state'));
      } catch (error) {
        document.getElementById('freshnessLabel').textContent = 'Portal removal failed: ' + error.message;
      }
    });
  });
}

function renderTransforms() {
  const list = document.getElementById('transformList');
  if (!list) return;
  const edges = state.transforms?.edges || [];
  if (!edges.length) {
    list.innerHTML = '<span class="muted">No frame transforms published.</span>';
    return;
  }
  list.innerHTML = edges.slice().reverse().map((edge) =>
    '<div class="region-entry"><span><strong>r' + edge.revision + '</strong> · ' +
    escapeHtml(edge.fromFrame) + ' → ' + escapeHtml(edge.toFrame) + ' · translate (' +
    Number(edge.translation?.x || 0).toFixed(2) + ', ' + Number(edge.translation?.y || 0).toFixed(2) + ', ' +
    Number(edge.translation?.z || 0).toFixed(2) + ') · scale ' + Number(edge.scale || 1).toFixed(3) + '</span></div>'
  ).join('');
}

function syncBackgroundImage() {
  const dataUrl = state.scene?.background?.dataUrl || null;
  if (dataUrl === state.backgroundImageKey) return;
  state.backgroundImageKey = dataUrl;
  state.backgroundImage = null;
  if (!dataUrl) return;
  const image = new Image();
  image.onload = () => {
    if (state.backgroundImageKey !== dataUrl) return;
    state.backgroundImage = image;
    draw();
  };
  image.onerror = () => {
    if (state.backgroundImageKey === dataUrl) {
      document.getElementById('freshnessLabel').textContent = 'Imported background could not be rendered.';
    }
  };
  image.src = dataUrl;
}

function renderBackground() {
  const list = document.getElementById('backgroundState');
  const clear = document.getElementById('clearBackgroundButton');
  if (!list || !clear) return;
  const background = state.scene?.background;
  clear.disabled = !background;
  list.innerHTML = background
    ? '<div class="region-entry"><span><strong>' + escapeHtml(background.name || 'local image') + '</strong> · ' +
      background.width.toFixed(2) + ' × ' + background.height.toFixed(2) + ' ' + escapeHtml(state.scene.unit || 'm') +
      ' · ' + Math.round(background.opacity * 100) + '% opacity</span></div>'
    : '<span class="muted">No local background imported.</span>';
  const fields = [
    ['backgroundX', background?.x], ['backgroundY', background?.y], ['backgroundWidth', background?.width],
    ['backgroundHeight', background?.height], ['backgroundRotation', background?.rotationDeg], ['backgroundOpacity', background?.opacity]
  ];
  fields.forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input && document.activeElement !== input && value !== undefined) input.value = value;
  });
}

function updateObservation(observation) {
  const key = observation.sourceId + ':' + observation.channel;
  const next = state.observations.filter((item) => item.sourceId + ':' + item.channel !== key);
  next.push(observation);
  state.observations = next;
  if (state.baselineCapture && observation.status !== 'stale' && observation.status !== 'rejected') {
    state.baselineCapture.samples.push({
      sourceId: observation.sourceId,
      channel: observation.channel,
      value: observation.value,
      timestampMs: observation.timestampMs,
      status: observation.status
    });
    if (state.baselineCapture.samples.length > 1024) state.baselineCapture.samples.shift();
  }
  if (state.viewPaused) return;
  render();
}

function renderLayers() {
  layerPanel.innerHTML = '';
  const layersById = new Map(DISPLAY_LAYERS.map((item) => [item[0], item]));
  const renderLayer = (id) => {
    const [, label, color] = layersById.get(id);
    const row = document.createElement('label');
    row.className = 'layer-row';
    row.innerHTML = '<input type="checkbox" data-channel="' + id + '" ' +
      (state.visible[id] ? 'checked' : '') + '><span class="layer-swatch" style="color:' +
      color + ';background:' + color + '"></span><span>' + escapeHtml(label) + '</span>';
    row.querySelector('input').addEventListener('change', (event) => {
      state.visible[id] = event.target.checked;
      render();
    });
    layerPanel.appendChild(row);
  };
  LAYER_GROUPS.forEach((group) => {
    const heading = document.createElement('div');
    heading.className = 'layer-group-heading';
    const allVisible = group.layers.every((id) => state.visible[id]);
    heading.innerHTML = '<span>' + escapeHtml(group.label) + '</span><button class="button small ghost" type="button" data-layer-group="' +
      escapeHtml(group.id) + '">' + (allVisible ? 'Hide group' : 'Show group') + '</button>';
    heading.querySelector('[data-layer-group]').addEventListener('click', () => {
      group.layers.forEach((id) => { state.visible[id] = !allVisible; });
      render();
    });
    layerPanel.appendChild(heading);
    group.layers.forEach(renderLayer);
  });
  document.getElementById('layerCount').textContent = DISPLAY_LAYERS.filter((item) => state.visible[item[0]]).length;
}

function renderFieldSettings() {
  const power = document.getElementById('fieldPower');
  const radius = document.getElementById('fieldRadius');
  const hint = document.getElementById('fieldSettingsHint');
  if (!power || !radius || !hint) return;
  if (document.activeElement !== power) power.value = state.fieldSettings.power;
  if (document.activeElement !== radius) radius.value = state.fieldSettings.radius;
  hint.textContent = 'Power ' + state.fieldSettings.power + ' · ' +
    (state.fieldSettings.radius > 0 ? 'search radius ' + state.fieldSettings.radius + ' ' + (state.scene?.unit || 'm') + '.' : 'unlimited search radius.') +
    ' Cells outside the radius show insufficient data.';
}

function renderPresentationSettings() {
  const select = document.getElementById('cameraTilt');
  const hint = document.getElementById('cameraTiltHint');
  if (!select || !hint) return;
  if (document.activeElement !== select) select.value = String(state.cameraTiltDeg);
  hint.textContent = state.cameraTiltDeg === 0
    ? 'Authoritative 2D scene view.'
    : 'Presentation tilt only; measurements and evidence remain in x/y scene coordinates.';
}

function renderBaseline() {
  const capture = document.getElementById('captureBaselineButton');
  const clear = document.getElementById('clearBaselineButton');
  const hint = document.getElementById('baselineHint');
  if (!capture || !clear || !hint) return;
  const available = latestValidObservations(activeObservations()).length;
  capture.disabled = available === 0;
  clear.disabled = !state.baseline;
  hint.textContent = state.baseline
    ? 'Captured ' + state.baseline.sampleCount + ' samples across ' + state.baseline.observationCount + ' channels at ' + new Date(state.baseline.capturedAtMs).toLocaleTimeString() + '. Red is above baseline; blue is below (capped z-score).'
    : state.baselineCapture
      ? 'Collecting bounded baseline samples. Let the scene settle, then stop and save the window.'
      : 'No baseline captured. The overlay is local, derived, and not part of session export.';
  capture.textContent = state.baselineCapture ? 'Stop & save baseline' : 'Start baseline window';
}

function fieldWeight(distance) {
  if (state.fieldSettings.radius > 0 && distance > state.fieldSettings.radius) return 0;
  return 1 / Math.max(distance, .08) ** state.fieldSettings.power;
}

function renderSources() {
  sourceList.innerHTML = '';
  (state.scene?.sources || []).forEach((source) => {
    const observation = state.observations.find((item) => item.sourceId === source.id && item.channel === source.channels[0]);
    const stale = observation?.status === 'stale';
    const wrapper = document.createElement('div');
    wrapper.className = 'source-entry';
    const row = document.createElement('div');
    row.className = 'source-row ' + (stale ? '' : 'live');
    row.innerHTML = '<span class="layer-swatch" style="color:' + colorFor(source.channels[0]) +
      ';background:' + colorFor(source.channels[0]) + '"></span><span>' +
      escapeHtml(source.name) + '</span><span class="source-meta">' +
      (stale ? 'stale' : observation ? 'live' : '—') + '</span>';
    wrapper.appendChild(row);
    if (source.adapterType === 'manual') {
      const control = document.createElement('form');
      control.className = 'manual-control';
      const range = source.range || RANGES[source.channels[0]] || [0, 1];
      control.innerHTML = '<input type="number" step="any" aria-label="Value for ' + escapeHtml(source.name) +
        '" placeholder="' + escapeHtml(String(range[0])) + '–' + escapeHtml(String(range[1])) + '">' +
        '<button class="button small ghost" type="submit">Send</button>';
      control.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = control.querySelector('input');
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        try {
          await api('/api/observations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              schemaVersion: '0.1',
              id: 'manual_' + Date.now(),
              sourceId: source.id,
              channel: source.channels[0],
              timestampMs: Date.now(),
              value,
              unit: source.unit || 'normalized',
              status: 'measured',
              quality: { score: 1, state: 'good', reasons: [] },
              position: source.position
            })
          });
          input.value = '';
        } catch (error) {
          document.getElementById('freshnessLabel').textContent = 'Manual observation rejected: ' + error.message;
        }
      });
      wrapper.appendChild(control);
    }
    sourceList.appendChild(wrapper);
  });
  document.getElementById('sourceCount').textContent = (state.scene?.sources || []).length;
}

function renderSessions() {
  const select = document.getElementById('sessionSelect');
  const compareSelect = document.getElementById('compareSessionSelect');
  const current = select.value;
  const compareCurrent = compareSelect.value;
  select.innerHTML = '<option value="">Choose session</option>';
  compareSelect.innerHTML = '<option value="">Choose session</option>';
  state.sessions.forEach((session) => {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = new Date(session.startedAtMs).toLocaleString() + ' · ' + (session.state || 'recorded') + ' · ' + session.observationCount + ' obs';
    select.appendChild(option);
    compareSelect.appendChild(option.cloneNode(true));
  });
  select.value = current;
  compareSelect.value = compareCurrent;
}

function renderDiagnostics() {
  const list = document.getElementById('diagnosticsList');
  document.getElementById('diagnosticCount').textContent = state.diagnostics.length;
  if (!state.diagnostics.length) {
    list.innerHTML = '<span class="muted">No rejected observations.</span>';
    return;
  }
  list.innerHTML = state.diagnostics.slice(-5).reverse().map((diagnostic) =>
    '<div class="diag-item"><strong>' + escapeHtml(diagnostic.id) + '</strong><br>' +
    escapeHtml((diagnostic.reasons || []).map((reason) => reason.message || reason).join(', ')) + '</div>'
  ).join('');
}

function replayEvidenceMarkers() {
  if (!state.replay) return [];
  const markers = (state.replay.events || []).map((event) => ({
    id: event.id,
    timestampMs: event.startMs,
    kind: 'activity',
    label: 'activity change',
    detail: event.channel + ' · Δ ' + Number(event.magnitude || 0).toFixed(2)
  }));
  (state.replay.journal || []).forEach((entry) => {
    if (!JOURNAL_MARKER_TYPES.has(entry.type) || !Number.isFinite(entry.timestampMs)) return;
    markers.push({
      id: entry.id,
      timestampMs: entry.timestampMs,
      kind: 'journal',
      label: JOURNAL_MARKER_LABELS[entry.type] || entry.type,
      detail: 'journal #' + entry.sequence
    });
  });
  return markers.filter((marker) => Number.isFinite(marker.timestampMs)).sort((left, right) =>
    left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)
  );
}

function renderTimelineMarkers(first, last) {
  const container = document.getElementById('timelineMarkers');
  const summary = document.getElementById('timelineMarkerSummary');
  if (!container || !summary) return;
  container.innerHTML = '';
  const markers = replayEvidenceMarkers();
  if (!state.replay || !markers.length) {
    summary.textContent = state.replay
      ? 'No retained activity or runtime-journal markers in this session.'
      : 'Replay markers appear when a recorded session is open.';
    return;
  }
  const span = Math.max(1, last - first);
  markers.forEach((marker) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline-marker ' + marker.kind;
    button.style.left = Math.max(0, Math.min(100, ((marker.timestampMs - first) / span) * 100)) + '%';
    button.dataset.time = String(marker.timestampMs);
    button.title = marker.label + ' · ' + new Date(marker.timestampMs).toLocaleTimeString() + ' · ' + marker.detail;
    button.setAttribute('aria-label', 'Jump to ' + button.title);
    button.addEventListener('click', () => {
      state.replayTime = marker.timestampMs;
      render();
    });
    container.appendChild(button);
  });
  const journalCount = markers.filter((marker) => marker.kind === 'journal').length;
  const activityCount = markers.length - journalCount;
  summary.textContent = markers.length + ' retained markers · ' + activityCount + ' activity · ' + journalCount + ' runtime journal';
}

function renderEvents() {
  const list = document.getElementById('eventsList');
  const sourceEvents = state.replay
    ? (state.replay.events || []).filter((event) => event.startMs <= state.replayTime)
    : state.events;
  const events = sourceEvents.slice(-8).reverse();
  document.getElementById('eventCount').textContent = events.length;
  if (!events.length) {
    list.innerHTML = '<span class="muted">No change events yet.</span>';
    return;
  }
  list.innerHTML = events.map((event) => {
    const source = sourceById(event.sourceId);
    return '<div class="event-item"><strong>' + escapeHtml(source?.name || event.sourceId) + '</strong> · ' +
      escapeHtml(event.channel) + '<br>' + new Date(event.startMs).toLocaleTimeString() +
      ' · Δ ' + Number(event.magnitude || 0).toFixed(2) + '</div>';
  }).join('');
}

function renderBenchmark() {
  const badge = document.getElementById('benchmarkBadge');
  const button = document.getElementById('benchmarkButton');
  const result = document.getElementById('benchmarkResult');
  if (!badge || !button || !result) return;
  button.disabled = state.benchmarkBusy;
  button.textContent = state.benchmarkBusy ? 'Running…' : 'Run E2 benchmark';
  if (!state.benchmarkReceipt) {
    badge.textContent = 'NOT RUN';
    result.innerHTML = '<span class="muted">No benchmark receipt yet.</span>';
    return;
  }
  const receipt = state.benchmarkReceipt;
  badge.textContent = receipt.replay?.deterministic ? 'E2 / STABLE' : 'E2 / DRIFT';
  result.innerHTML = [
    ['Frames', receipt.admittedCount + ' admitted · ' + receipt.rejectedCount + ' rejected'],
    ['Admission', 'p50 ' + receipt.admissionLatencyUs.p50 + ' µs · p95 ' + receipt.admissionLatencyUs.p95 + ' µs'],
    ['Field', receipt.fieldCellCount + ' cells · ' + receipt.fieldEvaluationMs + ' ms'],
    ['Replay', receipt.replay?.deterministic ? 'deterministic' : 'drift detected']
  ].map(([label, value]) => '<div class="benchmark-row"><span>' + label + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');
}

function renderBurstBenchmark() {
  const button = document.getElementById('burstBenchmarkButton');
  const result = document.getElementById('burstBenchmarkResult');
  if (!button || !result) return;
  button.disabled = state.burstBusy;
  button.textContent = state.burstBusy ? 'Running burst…' : 'Run 10k burst check';
  if (!state.burstReceipt) {
    result.innerHTML = '<span class="muted">No burst receipt yet.</span>';
    return;
  }
  const receipt = state.burstReceipt;
  result.innerHTML = [
    ['Burst', receipt.requestedFrames + ' requested · ' + receipt.admittedCount + ' admitted'],
    ['Backpressure', receipt.droppedCount + ' dropped · queue ' + receipt.queueCapacity],
    ['Timing', receipt.admissionLatencyUs.p95 + ' µs p95 · ' + receipt.framesPerSecond + ' frames/s host-local'],
    ['Receipt', receipt.receiptDigest.slice(0, 12) + '… verified']
  ].map(([label, value]) => '<div class="benchmark-row"><span>' + label + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');
}

function renderCapabilities() {
  const list = document.getElementById('capabilityList');
  const count = document.getElementById('capabilityCount');
  if (!list || !count) return;
  const claims = state.capabilities?.claims || [];
  count.textContent = claims.length;
  if (!claims.length) {
    list.innerHTML = '<span class="muted">Capability matrix unavailable.</span>';
    return;
  }
  list.innerHTML = claims.map((claim) =>
    '<div class="capability-row"><div><strong>' + escapeHtml(claim.label) + '</strong><span>' +
    escapeHtml(claim.note) + '</span></div><em class="capability-status status-' + escapeHtml(claim.status) + '">' +
    escapeHtml(claim.status) + ' · ' + escapeHtml(claim.evidenceLevel) + '</em></div>'
  ).join('');
}

function renderInspector() {
  const title = document.getElementById('inspectorTitle');
  const hint = document.getElementById('inspectorHint');
  const body = document.getElementById('inspectorBody');
  if (!state.selected) {
    title.textContent = 'Select an observation';
    hint.textContent = 'Click a point in the scene to inspect its provenance.';
    body.className = 'inspector-body empty-inspector';
    body.innerHTML = '<span class="muted">Source, timestamp, unit, quality, position, and processing path will appear here.</span>';
    return;
  }
  const observation = state.selected;
  const source = sourceById(observation.sourceId);
  const support = observation.support || source?.support;
  const provenance = Array.isArray(observation.provenance) ? observation.provenance : [];
  const inputObservationIds = provenance
    .filter((edge) => edge.relation === 'derived_from')
    .map((edge) => edge.parentId);
  const provenanceLabel = provenance.length
    ? provenance.map((edge) => edge.relation + ': ' + edge.parentId).join(' · ')
    : 'none recorded';
  const inputLabel = inputObservationIds.length ? inputObservationIds.join(' · ') : 'none recorded';
  const ageMs = Number.isFinite(observation.ageMs)
    ? observation.ageMs
    : Number.isFinite(observation.timestampMs)
      ? Math.max(0, Date.now() - observation.timestampMs)
      : null;
  const ageLabel = ageMs === null
    ? 'not available'
    : ageMs < 1000 ? Math.round(ageMs) + ' ms' : (ageMs / 1000).toFixed(1) + ' s';
  const positionLabel = observation.position
    ? observation.position.x.toFixed(2) + ', ' + observation.position.y.toFixed(2)
    : observation.poseRef ? 'resolved from pose' : 'source anchor';
  const supportLabel = support?.type || (observation.position ? 'PointSupport' : 'unknown');
  const processingPath = [
    observation.status === 'measured' ? 'source → normalized observation' : 'source → derived feature → scene',
    observation.poseRef ? 'pose history resolved' : null,
    support && support.type !== 'PointSupport' ? support.type + ' sampled' : null
  ].filter(Boolean).join(' · ');
  title.textContent = source?.name || observation.sourceId;
  hint.textContent = observation.feature || 'Normalized observation';
  body.className = 'inspector-body';
  body.innerHTML = '<div class="detail-grid">' +
    detail('Channel', observation.channel) +
    detail('Value', String(observation.value) + ' ' + observation.unit) +
    detail('Status', '<span class="badge">' + escapeHtml(observation.status || 'unknown') + '</span>', { html: true }) +
    detail('Evidence', observation.evidenceState || observation.status) +
    detail('Quality', Math.round((observation.quality?.score || 0) * 100) + '% · ' + (observation.quality?.state || 'unknown')) +
    detail('Source', observation.sourceId) +
    detail('Provider', observation.provider?.id || 'not declared') +
    detail('Provider digest', observation.provider?.digest || 'not declared') +
    detail('Timestamp', new Date(observation.timestampMs).toLocaleTimeString()) +
    detail('Age', ageLabel) +
    detail('Position', positionLabel) +
    detail('Support', supportLabel) +
    detail('Pose', observation.poseRef
      ? observation.poseRef + ' · ' + (Number.isFinite(observation.poseDistanceMs) ? observation.poseDistanceMs + ' ms from sample' : 'resolved')
      : 'not resolved') +
    detail('Calibration', observation.calibrationRef || source?.calibrationState || 'not declared') +
    detail('Source profile', observation.sourceProfileDigest || source?.sourceProfileDigest || 'not declared') +
    detail('Transform revision', Number.isInteger(observation.transformRevision) ? String(observation.transformRevision) : 'not declared') +
    detail('Sequence', Number.isInteger(observation.sequence) ? String(observation.sequence) : 'not declared') +
    detail('Input observations', inputLabel) +
    detail('Provenance', provenanceLabel) +
    detail('Privacy', observation.privacyClass || source?.privacyClass || source?.privacyMode || 'not declared') +
    detail('Processing', processingPath) +
    '</div>';
}

function detail(label, value, { html = false } = {}) {
  return '<div class="detail-item"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' +
    (html ? value : escapeHtml(value)) + '</span></div>';
}

function colorFor(channel) {
  const item = CHANNELS.find((entry) => entry[0] === channel);
  return item ? item[2] : '#6ce4db';
}

function sceneTransform() {
  const rect = canvas.getBoundingClientRect();
  const pad = 32;
  const projectionShear = Math.tan((state.cameraTiltDeg * Math.PI) / 180) * .24;
  return {
    width: rect.width,
    height: rect.height,
    x: (value) => pad + value / state.scene.width * (rect.width - pad * 2),
    y: (value) => pad + value / state.scene.height * (rect.height - pad * 2),
    sx: (rect.width - pad * 2) / state.scene.width,
    sy: (rect.height - pad * 2) / state.scene.height,
    projectionShear,
    projectionOffset: -projectionShear * rect.height / 2,
    pad
  };
}

function scenePointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const transform = sceneTransform();
  const projectedX = event.clientX - rect.left;
  const projectedY = event.clientY - rect.top;
  const localX = projectedX - transform.projectionOffset - transform.projectionShear * projectedY;
  return {
    x: Math.max(0, Math.min(state.scene.width, (localX - transform.pad) / transform.sx)),
    y: Math.max(0, Math.min(state.scene.height, (projectedY - transform.pad) / transform.sy))
  };
}

function nearestSource(point) {
  let nearest = null;
  let distance = Infinity;
  (state.scene.sources || []).forEach((source) => {
    if (!source.position) return;
    const current = Math.hypot(source.position.x - point.x, source.position.y - point.y);
    if (current < distance) {
      distance = current;
      nearest = source;
    }
  });
  return distance < .45 ? nearest : null;
}

function supportPositions(observation, source) {
  const support = observation.support || source?.support;
  const fallback = observation.position || source?.position;
  const center = support?.center || support?.position || fallback;
  if (!center) return [];
  if (support?.type === 'RegionSupport') {
    const radius = Number.isFinite(support.radius) ? support.radius : 0;
    return radius > 0
      ? [
        center,
        { x: center.x + radius, y: center.y },
        { x: center.x - radius, y: center.y },
        { x: center.x, y: center.y + radius },
        { x: center.x, y: center.y - radius }
      ]
      : [center];
  }
  if (support?.type === 'PathSupport' && Array.isArray(support.points)) return support.points;
  if (support?.type === 'EllipseSupport') {
    const radiusX = Number.isFinite(support.radiusX) ? support.radiusX : 0;
    const radiusY = Number.isFinite(support.radiusY) ? support.radiusY : 0;
    return Array.from({ length: 9 }, (_, index) => {
      if (index === 0) return center;
      const angle = (index - 1) * Math.PI / 4;
      return { x: center.x + radiusX * Math.cos(angle), y: center.y + radiusY * Math.sin(angle) };
    });
  }
  return [center];
}

function drawSupportGeometry(valid, transform) {
  if (!state.visible.support) return;
  context.save();
  context.lineWidth = 1.2;
  context.setLineDash([4, 3]);
  valid.forEach((observation) => {
    const source = sourceById(observation.sourceId);
    const support = observation.support || source?.support;
    if (!support || support.type === 'PointSupport' || support.type === 'UnknownSupport') return;
    const center = support.center || support.position || observation.position || source?.position;
    const color = colorFor(observation.channel);
    context.strokeStyle = hexToRgba(color, .58);
    context.beginPath();
    if (support.type === 'RegionSupport' && center && Number.isFinite(support.radius)) {
      context.arc(transform.x(center.x), transform.y(center.y), support.radius * (transform.sx + transform.sy) / 2, 0, Math.PI * 2);
    } else if (support.type === 'EllipseSupport' && center && Number.isFinite(support.radiusX) && Number.isFinite(support.radiusY)) {
      context.ellipse(transform.x(center.x), transform.y(center.y), support.radiusX * transform.sx, support.radiusY * transform.sy, 0, 0, Math.PI * 2);
    } else if (support.type === 'PathSupport' && Array.isArray(support.points) && support.points.length > 1) {
      context.moveTo(transform.x(support.points[0].x), transform.y(support.points[0].y));
      support.points.slice(1).forEach((point) => context.lineTo(transform.x(point.x), transform.y(point.y)));
    } else {
      return;
    }
    context.stroke();
  });
  context.restore();
}

function drawUncertainty(valid, transform) {
  if (!state.visible.uncertainty) return;
  context.save();
  context.lineWidth = 1;
  context.setLineDash([2, 3]);
  valid.forEach((observation) => {
    const source = sourceById(observation.sourceId);
    const position = observation.position || source?.position;
    const support = observation.support || source?.support;
    const radius = position?.uncertaintyRadius ?? support?.uncertaintyRadius;
    if (!position || !Number.isFinite(radius) || radius <= 0) return;
    context.strokeStyle = 'rgba(255, 180, 123, .7)';
    context.beginPath();
    context.arc(transform.x(position.x), transform.y(position.y), radius * (transform.sx + transform.sy) / 2, 0, Math.PI * 2);
    context.stroke();
  });
  context.restore();
}

function drawTemporalTrails(transform) {
  if (!state.visible.trails || !state.replay) return;
  const grouped = new Map();
  activeObservations().filter((observation) => observation.status !== 'stale' && observation.status !== 'rejected')
    .forEach((observation) => {
      const key = observation.sourceId + ':' + observation.channel;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(observation);
    });
  context.save();
  context.lineWidth = 1.5;
  grouped.forEach((observations, key) => {
    const ordered = observations.sort((left, right) => left.timestampMs - right.timestampMs).slice(-24);
    if (ordered.length < 2) return;
    const channel = key.split(':').slice(1).join(':');
    for (let index = 1; index < ordered.length; index += 1) {
      const from = supportPositions(ordered[index - 1], sourceById(ordered[index - 1].sourceId))[0];
      const to = supportPositions(ordered[index], sourceById(ordered[index].sourceId))[0];
      if (!from || !to) continue;
      context.strokeStyle = hexToRgba(colorFor(channel), .08 + (.28 * index / ordered.length));
      context.beginPath();
      context.moveTo(transform.x(from.x), transform.y(from.y));
      context.lineTo(transform.x(to.x), transform.y(to.y));
      context.stroke();
    }
  });
  context.restore();
}

function drawEventPulses(transform) {
  if (!state.visible.events) return;
  const sourceEvents = state.replay
    ? (state.replay.events || []).filter((event) => event.startMs <= state.replayTime)
    : state.events;
  context.save();
  sourceEvents.slice(-12).forEach((event) => {
    const source = sourceById(event.sourceId);
    const position = event.position || source?.position;
    if (!position) return;
    const radius = 8 + Math.min(12, Number(event.magnitude || 0) * 12);
    context.strokeStyle = 'rgba(255, 143, 151, .62)';
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(transform.x(position.x), transform.y(position.y), radius, 0, Math.PI * 2);
    context.stroke();
  });
  context.restore();
}

function drawMeasurement(transform) {
  if (!state.measureStart) return;
  const end = state.measureEnd || state.measureStart;
  context.save();
  context.strokeStyle = '#ffd166';
  context.fillStyle = '#ffd166';
  context.lineWidth = 2;
  context.setLineDash([5, 4]);
  context.beginPath();
  context.moveTo(transform.x(state.measureStart.x), transform.y(state.measureStart.y));
  context.lineTo(transform.x(end.x), transform.y(end.y));
  context.stroke();
  context.setLineDash([]);
  [state.measureStart, end].forEach((point) => {
    context.beginPath();
    context.arc(transform.x(point.x), transform.y(point.y), 4, 0, Math.PI * 2);
    context.fill();
  });
  const distance = Math.hypot(end.x - state.measureStart.x, end.y - state.measureStart.y);
  context.font = '11px system-ui';
  context.fillText(distance.toFixed(2) + ' ' + (state.scene.unit || 'm'), transform.x(end.x) + 8, transform.y(end.y) - 8);
  context.restore();
}

function drawBackground(transform) {
  const background = state.scene?.background;
  if (!state.visible.background || !background || !state.backgroundImage) return;
  context.save();
  context.globalAlpha = background.opacity;
  context.translate(
    transform.x(background.x + background.width / 2),
    transform.y(background.y + background.height / 2)
  );
  context.rotate((background.rotationDeg * Math.PI) / 180);
  context.drawImage(
    state.backgroundImage,
    -transform.sx * background.width / 2,
    -transform.sy * background.height / 2,
    transform.sx * background.width,
    transform.sy * background.height
  );
  context.restore();
}

function drawActivityField(valid, transform) {
  if (!state.visible.activity) return;
  const cols = 22;
  const rows = 18;
  const color = '#d7fff7';
  const recomputed = state.replayArtifact?.mode === 'recompute' ? state.replayArtifact.field : null;
  if (recomputed) {
    recomputed.cells.forEach((cell) => {
      if (cell.intensity === null) return;
      const supportOpacity = state.visible.support ? (.25 + cell.support * .75) : .6;
      const alpha = (.025 + cell.intensity * .12) * supportOpacity;
      context.fillStyle = hexToRgba(color, alpha);
      context.fillRect(
        transform.x(cell.x - state.scene.width / recomputed.width / 2),
        transform.y(cell.y - state.scene.height / recomputed.height / 2),
        transform.sx * state.scene.width / recomputed.width + 1,
        transform.sy * state.scene.height / recomputed.height + 1
      );
    });
    return;
  }
  if (valid.length === 0) return;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = state.scene.width * (col + .5) / cols;
      const y = state.scene.height * (row + .5) / rows;
      let total = 0;
      let spatialWeightTotal = 0;
      let supportTotal = 0;
      valid.forEach((point) => {
        if (!state.visible[point.channel]) return;
        const source = sourceById(point.sourceId);
        supportPositions(point, source).forEach((position) => {
          const distance = Math.hypot(x - position.x, y - position.y);
          const weight = fieldWeight(distance);
          if (weight === 0) return;
          const confidence = point.quality?.score || 0;
          total += normalize(point.channel, point.value) * weight;
          spatialWeightTotal += weight;
          supportTotal += confidence * weight;
        });
      });
      const intensity = spatialWeightTotal ? Math.max(0, Math.min(1, total / spatialWeightTotal)) : 0;
      const support = spatialWeightTotal ? Math.max(0, Math.min(1, supportTotal / spatialWeightTotal)) : 0;
      if (!spatialWeightTotal) continue;
      const supportOpacity = state.visible.support ? (.25 + support * .75) : .6;
      context.fillStyle = hexToRgba(color, (.025 + intensity * .12) * supportOpacity);
      context.fillRect(
        transform.x(x - state.scene.width / cols / 2),
        transform.y(y - state.scene.height / rows / 2),
        transform.sx * state.scene.width / cols + 1,
        transform.sy * state.scene.height / rows + 1
      );
    }
  }
}

function drawBaselineField(valid, transform) {
  if (!state.visible.baseline || !state.baseline) return;
  const current = latestValidObservations(valid);
  const baselineIndex = createBaselineIndex(state.baseline);
  if (!current.length) return;
  const cols = 22;
  const rows = 18;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = state.scene.width * (col + .5) / cols;
      const y = state.scene.height * (row + .5) / rows;
      let total = 0;
      let spatialWeightTotal = 0;
      current.forEach((point) => {
        const delta = baselineDelta(point, baselineIndex, normalize);
        if (delta === null || !state.visible[point.channel]) return;
        const source = sourceById(point.sourceId);
        supportPositions(point, source).forEach((position) => {
          const distance = Math.hypot(x - position.x, y - position.y);
          const weight = fieldWeight(distance);
          if (weight === 0) return;
          total += delta * weight;
          spatialWeightTotal += weight;
        });
      });
      if (!spatialWeightTotal) continue;
      const delta = Math.max(-1, Math.min(1, total / spatialWeightTotal));
      const magnitude = Math.min(1, Math.abs(delta) / 3);
      const color = delta >= 0 ? '#ff8f97' : '#79a7ff';
      context.fillStyle = hexToRgba(color, (.035 + magnitude * .2) * (state.visible.support ? .85 : 1));
      context.fillRect(
        transform.x(x - state.scene.width / cols / 2),
        transform.y(y - state.scene.height / rows / 2),
        transform.sx * state.scene.width / cols + 1,
        transform.sy * state.scene.height / rows + 1
      );
    }
  }
}

function draw() {
  if (!state.scene) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const transform = sceneTransform();
  const observations = activeObservations();
  const valid = observations.filter((item) => item.status !== 'stale' && item.status !== 'rejected');
  canvasEmpty.classList.toggle('hidden', valid.length > 0);

  const gradient = context.createRadialGradient(rect.width * .5, rect.height * .45, 10, rect.width * .5, rect.height * .45, rect.width * .7);
  gradient.addColorStop(0, '#152434');
  gradient.addColorStop(1, '#0a1017');
  context.fillStyle = gradient;
  context.fillRect(0, 0, rect.width, rect.height);

  context.save();
  context.translate(-transformProjectionOffset(rect), 0);
  context.transform(1, 0, transformProjectionShear(), 1, 0, 0);

  drawBackground(transform);

  context.strokeStyle = 'rgba(154, 188, 208, .08)';
  context.lineWidth = 1;
  for (let x = 0; x <= state.scene.width; x += 0.5) {
    context.beginPath(); context.moveTo(transform.x(x), transform.y(0)); context.lineTo(transform.x(x), transform.y(state.scene.height)); context.stroke();
  }
  for (let y = 0; y <= state.scene.height; y += 0.5) {
    context.beginPath(); context.moveTo(transform.x(0), transform.y(y)); context.lineTo(transform.x(state.scene.width), transform.y(y)); context.stroke();
  }

  context.strokeStyle = 'rgba(210, 235, 242, .35)';
  context.lineWidth = 1.5;
  context.strokeRect(transform.x(0), transform.y(0), transform.sx * state.scene.width, transform.sy * state.scene.height);

  if (state.visible.zones) {
    (state.scene.regions || []).forEach((region) => {
      if (!Array.isArray(region.points) || region.points.length < 3) return;
      context.save();
      context.beginPath();
      context.moveTo(transform.x(region.points[0].x), transform.y(region.points[0].y));
      region.points.slice(1).forEach((point) => context.lineTo(transform.x(point.x), transform.y(point.y)));
      context.closePath();
      const color = /^#[0-9a-f]{6}$/i.test(region.color || '') ? region.color : '#a9e88b';
      context.fillStyle = hexToRgba(color, .055);
      context.fill();
      context.strokeStyle = hexToRgba(color, .48);
      context.setLineDash([6, 4]);
      context.stroke();
      const anchor = region.points[0];
      context.setLineDash([]);
      context.fillStyle = hexToRgba(color, .85);
      context.font = '10px system-ui';
      context.fillText(region.name, transform.x(anchor.x) + 5, transform.y(anchor.y) + 13);
      context.restore();
    });
  }
  if (state.visible.portals) {
    (state.scene.portals || []).forEach((portal) => {
      if (!portal.from || !portal.to) return;
      context.save();
      const color = /^#[0-9a-f]{6}$/i.test(portal.color || '') ? portal.color : '#ffd166';
      context.strokeStyle = hexToRgba(color, .9);
      context.lineWidth = portal.open === false ? 4 : 2;
      context.setLineDash(portal.kind === 'portal' ? [5, 3] : []);
      context.beginPath();
      context.moveTo(transform.x(portal.from.x), transform.y(portal.from.y));
      context.lineTo(transform.x(portal.to.x), transform.y(portal.to.y));
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = hexToRgba(color, .95);
      context.font = '10px system-ui';
      context.fillText(portal.name, transform.x(portal.from.x) + 5, transform.y(portal.from.y) - 5);
      context.restore();
    });
  }

  drawActivityField(valid, transform);

  CHANNELS.forEach(([channel, label, color]) => {
    if (!state.visible[channel]) return;
    const points = valid.filter((item) => item.channel === channel);
    if (!points.length) return;
    const cols = 22;
    const rows = 18;
    const range = RANGES[channel] || [0, 1];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = state.scene.width * (col + .5) / cols;
        const y = state.scene.height * (row + .5) / rows;
        let total = 0; let spatialWeightTotal = 0; let supportTotal = 0;
        points.forEach((point) => {
          const source = sourceById(point.sourceId);
          supportPositions(point, source).forEach((position) => {
            const distance = Math.hypot(x - position.x, y - position.y);
            const weight = fieldWeight(distance);
            if (weight === 0) return;
            total += normalize(channel, point.value) * weight;
            spatialWeightTotal += weight;
            supportTotal += (point.quality?.score || 0) * weight;
          });
        });
        const intensity = spatialWeightTotal ? Math.max(0, Math.min(1, total / spatialWeightTotal)) : 0;
        const support = spatialWeightTotal ? Math.max(0, Math.min(1, supportTotal / spatialWeightTotal)) : 0;
        const supportOpacity = state.visible.support ? (.25 + support * .75) : .6;
        if (!spatialWeightTotal) continue;
        context.fillStyle = hexToRgba(color, (.045 + intensity * .19) * supportOpacity);
        context.fillRect(transform.x(x - state.scene.width / cols / 2), transform.y(y - state.scene.height / rows / 2),
          transform.sx * state.scene.width / cols + 1, transform.sy * state.scene.height / rows + 1);
      }
    }
  });

  drawBaselineField(valid, transform);

  drawTemporalTrails(transform);
  drawSupportGeometry(valid, transform);
  drawUncertainty(valid, transform);

  (state.scene.sources || []).forEach((source) => {
    const point = source.position;
    if (!point) return;
    const x = transform.x(point.x); const y = transform.y(point.y);
    const observation = observations.find((item) => item.sourceId === source.id);
    const color = colorFor(source.channels[0]);
    const uncalibrated = source.calibrationState !== 'calibrated';
    const inferred = observation?.status === 'inferred' || observation?.evidenceState === 'inferred' || observation?.evidenceState === 'derived';
    const ageMs = observation
      ? (Number.isFinite(observation.ageMs)
        ? observation.ageMs
        : Math.max(0, (state.replay ? state.replayTime : Date.now()) - observation.timestampMs))
      : null;
    context.beginPath();
    context.arc(x, y, 14, 0, Math.PI * 2);
    context.strokeStyle = state.visible.calibration && uncalibrated ? '#ffb47b' : hexToRgba(color, .18);
    context.setLineDash(state.visible.calibration && uncalibrated ? [3, 3] : []);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.fillStyle = color;
    context.shadowColor = color; context.shadowBlur = 12;
    if (inferred) {
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillRect(-5, -5, 10, 10);
      context.restore();
    } else {
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
    context.fillStyle = 'rgba(236, 244, 248, .72)';
    context.font = '10px system-ui';
    context.fillText(source.name, x + 10, y - 9);
    if (observation?.status === 'stale') {
      context.strokeStyle = '#ffb47b'; context.setLineDash([2, 3]);
      context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.stroke(); context.setLineDash([]);
    }
    if (state.visible.age && Number.isFinite(ageMs)) {
      const ageLabel = ageMs < 1000 ? Math.round(ageMs) + 'ms' : (ageMs / 1000).toFixed(1) + 's';
      context.fillStyle = observation.status === 'stale' ? '#ffb47b' : 'rgba(236, 244, 248, .5)';
      context.font = '9px system-ui';
      context.fillText(ageLabel, x + 10, y + 11);
    }
  });
  drawEventPulses(transform);
  drawMeasurement(transform);
  context.restore();
}

function transformProjectionShear() {
  return Math.tan((state.cameraTiltDeg * Math.PI) / 180) * .24;
}

function transformProjectionOffset(rect) {
  return transformProjectionShear() * rect.height / 2;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const number = parseInt(value, 16);
  return 'rgba(' + ((number >> 16) & 255) + ',' + ((number >> 8) & 255) + ',' + (number & 255) + ',' + alpha + ')';
}

function renderTimeline() {
  const slider = document.getElementById('timelineSlider');
  const evidenceBadge = document.getElementById('replayEvidenceBadge');
  if (!state.replay) {
    slider.disabled = true;
    slider.value = 100;
    document.getElementById('timelineTitle').textContent = state.recording ? 'Recording live session' : 'Live stream';
    document.getElementById('timelineReadout').textContent = 'Now';
    document.getElementById('modeLabel').textContent = 'LIVE / SIMULATOR';
    evidenceBadge.textContent = 'LIVE';
    renderTimelineMarkers(0, 1);
    return;
  }
  const observations = state.replay.observations || [];
  const timestamps = [
    ...observations.map((observation) => observation.timestampMs),
    ...replayEvidenceMarkers().map((marker) => marker.timestampMs)
  ].filter(Number.isFinite);
  const first = timestamps.length ? Math.min(...timestamps) : 0;
  const rawLast = timestamps.length ? Math.max(...timestamps) : first;
  const last = rawLast > first ? rawLast : first + 1;
  slider.disabled = false;
  slider.min = String(first);
  slider.max = String(last);
  state.replayTime = Math.max(first, Math.min(last, Number(state.replayTime || last)));
  slider.value = String(state.replayTime);
  renderTimelineMarkers(first, last);
  const labels = {
    historical: ['Replay session', 'REPLAY / RECORDED', 'RECORDED'],
    recompute: ['Recomputed session', 'REPLAY / RECOMPUTED', 'DERIVED'],
    determinism: ['Determinism check', state.replayReport?.ok ? 'VERIFY / STABLE' : 'VERIFY / DRIFT', state.replayReport?.ok ? 'STABLE' : 'DRIFT']
  };
  const label = labels[state.replayMode] || labels.historical;
  document.getElementById('timelineTitle').textContent = label[0];
  document.getElementById('timelineReadout').textContent = new Date(state.replayTime).toLocaleTimeString();
  document.getElementById('modeLabel').textContent = label[1];
  evidenceBadge.textContent = label[2];
}

function renderSessionVerification() {
  const button = document.getElementById('verifyButton');
  const result = document.getElementById('sessionVerification');
  const sessionId = document.getElementById('sessionSelect').value;
  if (!button || !result) return;
  button.disabled = !sessionId || state.verificationBusy;
  button.textContent = state.verificationBusy ? 'Checking…' : 'Verify';
  result.className = 'session-verification muted';
  if (!sessionId) {
    result.textContent = 'Select a session to verify its evidence package.';
    return;
  }
  if (state.sessionVerification?.sessionId !== sessionId) {
    result.textContent = 'Not verified for this session.';
    return;
  }
  const report = state.sessionVerification.report;
  if (!report.ok) {
    result.className = 'session-verification fail';
    result.textContent = 'Verification failed · ' + report.reasons.slice(0, 2).join(' · ');
    return;
  }
  result.className = 'session-verification ok';
  const checks = report.checks;
  result.textContent = 'Verified · ' + checks.observationCount + ' observations · ' +
    checks.poseCount + ' retained poses · journal ' + (checks.journalVerified ? 'intact' : 'not checked') +
    ' · refs ' + (checks.sourceReferencesVerified && checks.calibrationReferencesVerified &&
      checks.provenanceReferencesVerified && checks.poseReferencesVerified ? 'valid' : 'incomplete');
}

function renderComparison() {
  const button = document.getElementById('compareButton');
  const result = document.getElementById('comparisonResult');
  const leftId = document.getElementById('sessionSelect').value;
  const rightId = document.getElementById('compareSessionSelect').value;
  if (!button || !result) return;
  button.disabled = !leftId || !rightId || leftId === rightId || state.comparisonBusy;
  button.textContent = state.comparisonBusy ? 'Comparing…' : 'Compare';
  result.className = 'comparison-result muted';
  if (!leftId || !rightId) {
    result.textContent = 'Choose two sessions to compare derived fields.';
    return;
  }
  if (leftId === rightId) {
    result.textContent = 'Choose two different sessions.';
    return;
  }
  if (state.comparison?.leftSessionId !== leftId || state.comparison?.rightSessionId !== rightId) {
    result.textContent = 'Comparison not run for this pair.';
    return;
  }
  if (state.comparison.error) {
    result.className = 'comparison-result fail';
    result.textContent = 'Comparison failed · ' + state.comparison.error;
    return;
  }
  const comparison = state.comparison.artifact;
  result.className = 'comparison-result ok';
  result.textContent = 'DERIVED difference · ' + comparison.metrics.changedCellCount + ' changed of ' +
    comparison.metrics.cellCount + ' cells · max intensity Δ ' + comparison.metrics.maxAbsoluteIntensityDelta.toFixed(3) +
    ' · max support Δ ' + comparison.metrics.maxAbsoluteSupportDelta.toFixed(3);
}

function renderTemporalComparison() {
  const pinA = document.getElementById('pinATimeButton');
  const pinB = document.getElementById('pinBTimeButton');
  const compare = document.getElementById('compareTimeButton');
  const timeA = document.getElementById('pinATime');
  const timeB = document.getElementById('pinBTime');
  const result = document.getElementById('temporalComparisonResult');
  if (!pinA || !pinB || !compare || !timeA || !timeB || !result) return;
  const hasReplay = Boolean(state.replay);
  pinA.disabled = !hasReplay;
  pinB.disabled = !hasReplay;
  compare.disabled = !hasReplay || !Number.isFinite(state.temporalPins.a) || !Number.isFinite(state.temporalPins.b) || state.temporalComparisonBusy;
  compare.textContent = state.temporalComparisonBusy ? 'Comparing…' : 'Compare A/B';
  timeA.textContent = Number.isFinite(state.temporalPins.a) ? 'A · ' + new Date(state.temporalPins.a).toLocaleTimeString() : 'A · not pinned';
  timeB.textContent = Number.isFinite(state.temporalPins.b) ? 'B · ' + new Date(state.temporalPins.b).toLocaleTimeString() : 'B · not pinned';
  result.className = 'comparison-result muted';
  if (!hasReplay || !Number.isFinite(state.temporalPins.a) || !Number.isFinite(state.temporalPins.b)) {
    result.textContent = 'Pin two replay times to compare within one session.';
    return;
  }
  if (state.temporalComparison?.sessionId !== state.replay.id ||
      state.temporalComparison.leftTimeMs !== state.temporalPins.a || state.temporalComparison.rightTimeMs !== state.temporalPins.b) {
    result.textContent = 'Temporal comparison not run for these pins.';
    return;
  }
  if (state.temporalComparison.error) {
    result.className = 'comparison-result fail';
    result.textContent = 'Temporal comparison failed · ' + state.temporalComparison.error;
    return;
  }
  const metrics = state.temporalComparison.artifact.metrics;
  result.className = 'comparison-result ok';
  result.textContent = 'DERIVED temporal difference · ' + metrics.changedCellCount + ' changed of ' + metrics.cellCount +
    ' cells · max intensity Δ ' + metrics.maxAbsoluteIntensityDelta.toFixed(3) +
    ' · max support Δ ' + metrics.maxAbsoluteSupportDelta.toFixed(3);
}

function render() {
  if (!state.scene) return;
  document.getElementById('sceneName').textContent = state.scene.name;
  renderSceneTools();
  document.getElementById('connectionBadge').className = 'status-pill connected';
  document.getElementById('connectionBadge').innerHTML = '<span class="status-dot"></span>Local stream';
  document.getElementById('recordButton').textContent = state.recording ? 'Stop recording' : 'Start recording';
  document.getElementById('recordButton').classList.toggle('accent', !state.recording);
  document.getElementById('recordButton').classList.toggle('ghost', Boolean(state.recording));
  const pauseViewButton = document.getElementById('pauseViewButton');
  pauseViewButton.textContent = state.viewPaused ? 'Resume view' : 'Pause view';
  pauseViewButton.classList.toggle('edit-active', state.viewPaused);
  const selectedSessionId = document.getElementById('sessionSelect').value;
  document.getElementById('exportButton').disabled = !state.recording && !state.replay && !selectedSessionId;
  document.getElementById('encryptedExportButton').disabled = !state.recording && !state.replay && !selectedSessionId;
  document.getElementById('deleteButton').disabled = !state.replay && !selectedSessionId;
  document.getElementById('freshnessLabel').textContent = state.observations.length + ' current source channels';
  renderLayers(); renderFieldSettings(); renderPresentationSettings(); renderBaseline(); renderSources(); renderRegions(); renderPortals(); renderTransforms(); renderBackground(); renderSessions(); renderDiagnostics(); renderBenchmark(); renderBurstBenchmark(); renderCapabilities(); renderEvents(); renderInspector(); renderTimeline(); renderSessionVerification(); renderComparison(); renderTemporalComparison(); draw();
}

document.getElementById('recordButton').addEventListener('click', async () => {
  if (state.recording) {
    await api('/api/sessions/' + state.recording.id + '/stop', { method: 'POST' });
    const payload = await api('/api/state');
    hydrate(payload);
    return;
  }
  await api('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: state.scene.id }) });
  hydrate(await api('/api/state'));
});

document.getElementById('liveButton').addEventListener('click', () => {
  state.replay = null; state.replayArtifact = null; state.replayReport = null; state.replayMode = 'historical'; state.selected = null; state.viewPaused = false; state.baseline = null; state.baselineCapture = null;
  state.temporalPins = { a: null, b: null }; state.temporalComparison = null; api('/api/state').then(hydrate);
});

document.getElementById('pauseViewButton').addEventListener('click', () => {
  state.viewPaused = !state.viewPaused;
  render();
});

document.getElementById('fieldSettingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const power = Number(document.getElementById('fieldPower').value);
  const radius = Number(document.getElementById('fieldRadius').value);
  if (!Number.isFinite(power) || power < 0.5 || power > 6 || !Number.isFinite(radius) || radius < 0) {
    document.getElementById('freshnessLabel').textContent = 'Field power must be 0.5–6 and search radius must be zero or positive.';
    return;
  }
  state.fieldSettings = { power, radius };
  render();
});

document.getElementById('cameraTilt').addEventListener('change', (event) => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value) || ![0, 12, 24].includes(value)) return;
  state.cameraTiltDeg = value;
  render();
});

document.getElementById('captureBaselineButton').addEventListener('click', () => {
  if (!state.scene) return;
  if (!state.baselineCapture) {
    if (!latestValidObservations(activeObservations()).length) return;
    state.baselineCapture = { startedAtMs: Date.now(), samples: [] };
    render();
    return;
  }
  const observations = latestValidObservations(activeObservations());
  const samples = state.baselineCapture.samples.length
    ? state.baselineCapture.samples
    : observations.map((observation) => ({ ...observation }));
  if (!samples.length) return;
  state.baseline = createBaselineSnapshot({
    sceneId: state.scene.id,
    capturedAtMs: Date.now(),
    observations,
    samples,
    normalize
  });
  state.baselineCapture = null;
  render();
});

document.getElementById('clearBaselineButton').addEventListener('click', () => {
  state.baseline = null;
  state.baselineCapture = null;
  render();
});

document.getElementById('exportButton').addEventListener('click', () => {
  const id = state.recording?.id || state.replay?.id || document.getElementById('sessionSelect').value;
  if (id) window.location.href = '/api/sessions/' + id + '/export';
});

document.getElementById('encryptedExportButton').addEventListener('click', async () => {
  const id = state.recording?.id || state.replay?.id || document.getElementById('sessionSelect').value;
  if (!id) return;
  const passphrase = window.prompt('Choose an export passphrase (8+ characters).');
  if (passphrase === null) return;
  const confirmation = window.prompt('Enter the export passphrase again.');
  if (passphrase !== confirmation) {
    document.getElementById('freshnessLabel').textContent = 'Encrypted export cancelled: passphrases did not match.';
    return;
  }
  try {
    const envelope = await api('/api/sessions/' + id + '/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase })
    });
    downloadJson(id + '.encrypted.json', envelope);
    document.getElementById('freshnessLabel').textContent = 'Encrypted session export created locally.';
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Encrypted export failed: ' + error.message;
  }
});

document.getElementById('importButton').addEventListener('click', () => {
  document.getElementById('importInput').click();
});

document.getElementById('importInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    let importBody = imported;
    if (imported?.format === 'sidechannel-encrypted-session') {
      const passphrase = window.prompt('Enter the session export passphrase.');
      if (passphrase === null) return;
      importBody = { encryptedPackage: imported, passphrase };
    }
    await api('/api/sessions/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(importBody)
    });
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Import failed: ' + error.message;
  } finally {
    event.target.value = '';
  }
});

document.getElementById('replayButton').addEventListener('click', async () => {
  const id = document.getElementById('sessionSelect').value;
  if (!id) return;
  const mode = document.getElementById('replayModeSelect').value;
  const payload = await api('/api/sessions/' + id);
  const replayPayload = await api('/api/sessions/' + id + '/replay?mode=' + encodeURIComponent(mode));
  state.replay = payload.session;
  state.replayArtifact = replayPayload.replay || null;
  state.replayReport = replayPayload.report || null;
  if (mode === 'determinism') {
    state.replayArtifact = await api('/api/sessions/' + id + '/replay?mode=recompute').then((result) => result.replay);
  }
  state.replayMode = mode;
  state.baseline = null;
  state.baselineCapture = null;
  state.temporalPins = { a: null, b: null };
  state.temporalComparison = null;
  state.scene = state.replay.sceneSnapshot || state.scene;
  syncBackgroundImage();
  state.replayTime = state.replay.observations[state.replay.observations.length - 1]?.timestampMs || Date.now();
  state.events = state.replay.events || [];
  state.selected = null;
  render();
});

document.getElementById('sessionSelect').addEventListener('change', () => {
  state.temporalPins = { a: null, b: null };
  state.temporalComparison = null;
  render();
});

document.getElementById('verifyButton').addEventListener('click', async () => {
  const id = document.getElementById('sessionSelect').value;
  if (!id) return;
  state.verificationBusy = true;
  renderSessionVerification();
  try {
    state.sessionVerification = { sessionId: id, report: await api('/api/sessions/' + id + '/verify') };
  } catch (error) {
    state.sessionVerification = {
      sessionId: id,
      report: { ok: false, reasons: [error.message], checks: { observationCount: 0, poseCount: 0, journalVerified: false } }
    };
  } finally {
    state.verificationBusy = false;
    renderSessionVerification();
  }
});

document.getElementById('compareSessionSelect').addEventListener('change', () => renderComparison());

document.getElementById('compareButton').addEventListener('click', async () => {
  const leftSessionId = document.getElementById('sessionSelect').value;
  const rightSessionId = document.getElementById('compareSessionSelect').value;
  if (!leftSessionId || !rightSessionId || leftSessionId === rightSessionId) return;
  state.comparisonBusy = true;
  renderComparison();
  try {
    const payload = await api('/api/sessions/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leftSessionId, rightSessionId })
    });
    state.comparison = { leftSessionId, rightSessionId, artifact: payload.comparison };
  } catch (error) {
    state.comparison = { leftSessionId, rightSessionId, error: error.message };
  } finally {
    state.comparisonBusy = false;
    renderComparison();
  }
});

document.getElementById('pinATimeButton').addEventListener('click', () => {
  if (!state.replay) return;
  state.temporalPins.a = state.replayTime;
  state.temporalComparison = null;
  render();
});

document.getElementById('pinBTimeButton').addEventListener('click', () => {
  if (!state.replay) return;
  state.temporalPins.b = state.replayTime;
  state.temporalComparison = null;
  render();
});

document.getElementById('compareTimeButton').addEventListener('click', async () => {
  if (!state.replay || !Number.isFinite(state.temporalPins.a) || !Number.isFinite(state.temporalPins.b)) return;
  const sessionId = state.replay.id;
  const leftTimeMs = state.temporalPins.a;
  const rightTimeMs = state.temporalPins.b;
  state.temporalComparisonBusy = true;
  renderTemporalComparison();
  try {
    const payload = await api('/api/sessions/compare-time', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, leftTimeMs, rightTimeMs })
    });
    state.temporalComparison = { sessionId, leftTimeMs, rightTimeMs, artifact: payload.comparison };
  } catch (error) {
    state.temporalComparison = { sessionId, leftTimeMs, rightTimeMs, error: error.message };
  } finally {
    state.temporalComparisonBusy = false;
    renderTemporalComparison();
  }
});

document.getElementById('benchmarkButton').addEventListener('click', async () => {
  state.benchmarkBusy = true;
  renderBenchmark();
  try {
    const payload = await api('/api/benchmark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticks: 8, gridSize: 14, seed: 1337 })
    });
    state.benchmarkReceipt = payload.receipt;
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Benchmark failed: ' + error.message;
  } finally {
    state.benchmarkBusy = false;
    renderBenchmark();
  }
});

document.getElementById('burstBenchmarkButton').addEventListener('click', async () => {
  state.burstBusy = true;
  renderBurstBenchmark();
  try {
    const payload = await api('/api/benchmark/burst', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: 10000, sourceCount: 8, queueCapacity: 1024, seed: 1337 })
    });
    state.burstReceipt = payload.receipt;
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Burst benchmark failed: ' + error.message;
  } finally {
    state.burstBusy = false;
    renderBurstBenchmark();
  }
});

document.getElementById('deleteButton').addEventListener('click', async () => {
  const id = state.replay?.id || document.getElementById('sessionSelect').value;
  if (!id || !window.confirm('Delete this local session?')) return;
  await api('/api/sessions/' + id, { method: 'DELETE' });
  state.replay = null;
  state.replayArtifact = null;
  state.replayReport = null;
  state.sessionVerification = null;
  state.comparison = null;
  state.temporalPins = { a: null, b: null };
  state.temporalComparison = null;
  state.selected = null;
  hydrate(await api('/api/state'));
});

document.getElementById('timelineSlider').addEventListener('input', (event) => {
  if (!state.replay) return;
  state.replayTime = Number(event.target.value);
  render();
});

document.getElementById('editSceneButton').addEventListener('click', () => {
  state.editMode = !state.editMode;
  render();
});

document.getElementById('saveSceneButton').addEventListener('click', async () => {
  const width = Number(document.getElementById('sceneWidth').value);
  const height = Number(document.getElementById('sceneHeight').value);
  const unit = document.getElementById('sceneUnit').value;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !['m', 'ft', 'px'].includes(unit)) return;
  const scene = await api('/api/scenes/' + state.scene.id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width, height, unit })
  });
  state.scene = scene;
  syncBackgroundImage();
  render();
});

document.getElementById('sceneSelect').addEventListener('change', () => {
  document.getElementById('activateSceneButton').disabled = document.getElementById('sceneSelect').value === state.scene?.id;
});

document.getElementById('activateSceneButton').addEventListener('click', async () => {
  const sceneId = document.getElementById('sceneSelect').value;
  if (!sceneId || sceneId === state.scene?.id) return;
  try {
    await api('/api/scenes/' + encodeURIComponent(sceneId) + '/activate', { method: 'POST' });
    state.replay = null;
    state.replayArtifact = null;
    state.replayReport = null;
    state.baseline = null;
    state.baselineCapture = null;
    state.selected = null;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('sceneSwitchHint').textContent = 'Could not activate scene: ' + error.message;
  }
});

document.getElementById('addSceneButton').addEventListener('click', () => {
  const form = document.getElementById('sceneForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('newSceneName').focus();
});

document.getElementById('sceneForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('newSceneName').value.trim();
  const width = Number(document.getElementById('newSceneWidth').value);
  const height = Number(document.getElementById('newSceneHeight').value);
  const unit = document.getElementById('newSceneUnit').value;
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !['m', 'ft', 'px'].includes(unit)) {
    document.getElementById('sceneSwitchHint').textContent = 'New scene needs a name and positive bounded dimensions.';
    return;
  }
  try {
    await api('/api/scenes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, width, height, unit, sources: [], placements: [] })
    });
    document.getElementById('sceneForm').reset();
    document.getElementById('sceneForm').hidden = true;
    state.replay = null;
    state.replayArtifact = null;
    state.replayReport = null;
    state.baseline = null;
    state.baselineCapture = null;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('sceneSwitchHint').textContent = 'Could not create scene: ' + error.message;
  }
});

document.getElementById('measureButton').addEventListener('click', () => {
  state.measureMode = !state.measureMode;
  state.measuring = false;
  state.measureStart = null;
  state.measureEnd = null;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.measureMode) return;
  state.measureMode = false;
  state.measuring = false;
  state.measureStart = null;
  state.measureEnd = null;
  render();
});

document.getElementById('addRegionButton').addEventListener('click', () => {
  const form = document.getElementById('regionForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('regionName').focus();
});

document.getElementById('regionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('regionName').value.trim();
  const kind = document.getElementById('regionKind').value;
  const x = Number(document.getElementById('regionX').value);
  const y = Number(document.getElementById('regionY').value);
  const width = Number(document.getElementById('regionWidth').value);
  const height = Number(document.getElementById('regionHeight').value);
  if (!name || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      x + width > state.scene.width || y + height > state.scene.height) {
    document.getElementById('freshnessLabel').textContent = 'Region must remain inside the scene frame.';
    return;
  }
  try {
    await api('/api/scenes/' + state.scene.id + '/regions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        kind,
        points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
      })
    });
    document.getElementById('regionForm').reset();
    document.getElementById('regionForm').hidden = true;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not add region: ' + error.message;
  }
});

document.getElementById('addPortalButton').addEventListener('click', () => {
  const form = document.getElementById('portalForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('portalName').focus();
});

document.getElementById('portalForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('portalName').value.trim();
  const kind = document.getElementById('portalKind').value;
  const from = {
    x: Number(document.getElementById('portalFromX').value),
    y: Number(document.getElementById('portalFromY').value)
  };
  const to = {
    x: Number(document.getElementById('portalToX').value),
    y: Number(document.getElementById('portalToY').value)
  };
  if (!name || !Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y) ||
      (from.x === to.x && from.y === to.y) || from.x < 0 || from.y < 0 || to.x < 0 || to.y < 0 ||
      from.x > state.scene.width || to.x > state.scene.width || from.y > state.scene.height || to.y > state.scene.height) {
    document.getElementById('freshnessLabel').textContent = 'Portal endpoints must be distinct and inside the scene frame.';
    return;
  }
  try {
    await api('/api/scenes/' + state.scene.id + '/portals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, kind, from, to })
    });
    document.getElementById('portalForm').reset();
    document.getElementById('portalForm').hidden = true;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not add portal: ' + error.message;
  }
});

document.getElementById('addTransformButton').addEventListener('click', () => {
  const form = document.getElementById('transformForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('transformFromFrame').focus();
});

document.getElementById('transformForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fromFrame = document.getElementById('transformFromFrame').value.trim();
  const toFrame = document.getElementById('transformToFrame').value.trim();
  const translation = {
    x: Number(document.getElementById('transformX').value),
    y: Number(document.getElementById('transformY').value),
    z: Number(document.getElementById('transformZ').value)
  };
  const rotation = Number(document.getElementById('transformRotation').value);
  const scale = Number(document.getElementById('transformScale').value);
  if (!fromFrame || !toFrame || fromFrame === toFrame || Object.values(translation).some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(rotation) || !Number.isFinite(scale) || scale <= 0) {
    document.getElementById('freshnessLabel').textContent = 'Transform frames must differ and all numeric values must be finite; scale must be positive.';
    return;
  }
  try {
    await api('/api/transforms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromFrame, toFrame, translation, rotation, scale })
    });
    document.getElementById('transformForm').reset();
    document.getElementById('transformFromFrame').value = 'device';
    document.getElementById('transformToFrame').value = 'scene';
    document.getElementById('transformX').value = '0';
    document.getElementById('transformY').value = '0';
    document.getElementById('transformZ').value = '0';
    document.getElementById('transformRotation').value = '0';
    document.getElementById('transformScale').value = '1';
    document.getElementById('transformForm').hidden = true;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not publish transform: ' + error.message;
  }
});

document.getElementById('addBackgroundButton').addEventListener('click', () => {
  const form = document.getElementById('backgroundForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('backgroundFile').focus();
});

document.getElementById('backgroundForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.getElementById('backgroundFile').files?.[0];
  const x = Number(document.getElementById('backgroundX').value);
  const y = Number(document.getElementById('backgroundY').value);
  const width = Number(document.getElementById('backgroundWidth').value);
  const height = Number(document.getElementById('backgroundHeight').value);
  const rotationDeg = Number(document.getElementById('backgroundRotation').value);
  const opacity = Number(document.getElementById('backgroundOpacity').value);
  const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!file || !acceptedTypes.has(file.type) || file.size > 1_300_000 ||
      ![x, y, width, height, rotationDeg, opacity].every(Number.isFinite) || width <= 0 || height <= 0 ||
      x < 0 || y < 0 || x + width > state.scene.width || y + height > state.scene.height ||
      opacity < 0 || opacity > 1) {
    document.getElementById('freshnessLabel').textContent = 'Choose a PNG, JPEG, or WebP under 1.3 MB with a rectangle inside the scene frame.';
    return;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('could not read the local image'));
      reader.readAsDataURL(file);
    });
    await api('/api/scenes/' + state.scene.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ background: { dataUrl, mimeType: file.type, name: file.name, x, y, width, height, rotationDeg, opacity } })
    });
    document.getElementById('backgroundForm').reset();
    document.getElementById('backgroundForm').hidden = true;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not import background: ' + error.message;
  }
});

document.getElementById('clearBackgroundButton').addEventListener('click', async () => {
  if (!state.scene?.background) return;
  try {
    await api('/api/scenes/' + state.scene.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ background: null })
    });
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not remove background: ' + error.message;
  }
});

document.getElementById('addSourceButton').addEventListener('click', () => {
  const form = document.getElementById('sourceForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('sourceName').focus();
});

document.getElementById('sourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const channel = document.getElementById('sourceChannel').value;
  const name = document.getElementById('sourceName').value.trim();
  const unit = document.getElementById('sourceUnit').value.trim();
  const freshnessWindowMs = Number(document.getElementById('sourceFreshness').value);
  const min = Number(document.getElementById('sourceRangeMin').value);
  const max = Number(document.getElementById('sourceRangeMax').value);
  if (!name || !unit || !Number.isFinite(freshnessWindowMs) || freshnessWindowMs <= 0 ||
      !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
  try {
    await api('/api/scenes/' + state.scene.id + '/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        adapterType: 'manual',
        channels: [channel],
        capabilities: ['manual_observation'],
        unit,
        range: [min, max],
        freshnessWindowMs,
        privacyMode: 'local_numeric',
        connected: false,
        position: {
          x: state.scene.width / 2,
          y: state.scene.height / 2,
          uncertaintyRadius: 0.5
        },
        calibrationState: 'uncalibrated'
      })
    });
    document.getElementById('sourceForm').reset();
    document.getElementById('sourceUnit').value = 'normalized';
    document.getElementById('sourceFreshness').value = '2000';
    document.getElementById('sourceRangeMin').value = '0';
    document.getElementById('sourceRangeMax').value = '1';
    document.getElementById('sourceForm').hidden = true;
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('freshnessLabel').textContent = 'Could not add source: ' + error.message;
  }
});

canvas.addEventListener('pointerdown', (event) => {
  if (state.measureMode) {
    state.measuring = true;
    state.measureStart = scenePointFromEvent(event);
    state.measureEnd = state.measureStart;
    state.suppressNextCanvasClick = true;
    canvas.setPointerCapture(event.pointerId);
    render();
    return;
  }
  if (!state.editMode || !state.scene) return;
  const source = nearestSource(scenePointFromEvent(event));
  if (!source) return;
  state.draggedSourceId = source.id;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (state.measuring) {
    state.measureEnd = scenePointFromEvent(event);
    draw();
    renderSceneTools();
    return;
  }
  if (!state.draggedSourceId) return;
  const source = state.scene.sources.find((item) => item.id === state.draggedSourceId);
  if (!source) return;
  source.position = {
    ...(source.position || {}),
    ...scenePointFromEvent(event)
  };
  renderSources();
  draw();
});

canvas.addEventListener('pointerup', async (event) => {
  if (state.measuring) {
    state.measureEnd = scenePointFromEvent(event);
    state.measuring = false;
    state.measureMode = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render();
    return;
  }
  if (!state.draggedSourceId) return;
  const source = state.scene.sources.find((item) => item.id === state.draggedSourceId);
  state.draggedSourceId = null;
  if (!source) return;
  try {
    await api('/api/scenes/' + state.scene.id + '/sources/' + source.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        position: source.position,
        calibrationState: 'calibrated',
        calibratedAtMs: Date.now()
      })
    });
    hydrate(await api('/api/state'));
  } catch (error) {
    document.getElementById('editHint').textContent = 'Could not save placement: ' + error.message;
    render();
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('click', (event) => {
  if (state.suppressNextCanvasClick) {
    state.suppressNextCanvasClick = false;
    return;
  }
  if (!state.scene) return;
  if (state.editMode) return;
  const point = scenePointFromEvent(event);
  const x = point.x;
  const y = point.y;
  let nearest = null; let distance = Infinity;
  activeObservations().forEach((observation) => {
    const source = sourceById(observation.sourceId);
    const position = observation.position || source?.position;
    if (!position) return;
    const current = Math.hypot(position.x - x, position.y - y);
    if (current < distance) { distance = current; nearest = observation; }
  });
  state.selected = distance < .5 ? nearest : null;
  renderInspector();
});

window.addEventListener('resize', draw);

function connect() {
  const socket = new WebSocket('ws://' + window.location.host + '/ws/live');
  socket.onopen = () => {
    document.getElementById('connectionBadge').className = 'status-pill connected';
    document.getElementById('connectionBadge').innerHTML = '<span class="status-dot"></span>Local stream';
    refreshLiveState().catch((error) => {
      document.getElementById('freshnessLabel').textContent = 'Live snapshot refresh failed: ' + error.message;
    });
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') hydrate(message.state);
    if (message.type === 'observation.accepted') updateObservation(message.observation);
    if (message.type === 'observation.rejected') {
      state.diagnostics.push(message);
      renderDiagnostics();
    }
    if (message.type === 'event.detected') {
      state.events = [...state.events, message.event].slice(-40);
      if (!state.viewPaused) renderEvents();
    }
    if (message.type === 'scene.updated') { state.scene = message.scene; syncBackgroundImage(); render(); }
    if (message.type === 'session.state') api('/api/state').then(hydrate);
  };
  socket.onclose = () => {
    document.getElementById('connectionBadge').className = 'status-pill';
    document.getElementById('connectionBadge').innerHTML = '<span class="status-dot"></span>Reconnecting';
    setTimeout(connect, 1500);
  };
}

api('/api/state').then(hydrate).then(connect).catch((error) => {
  document.getElementById('freshnessLabel').textContent = error.message;
});
