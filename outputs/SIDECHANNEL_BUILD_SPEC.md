# SIDECHANNEL

## Make the Invisible World Visible

Product plan and implementation-ready build specification

Status: Greenfield v0.1 proposal  
Audience: Product, design, and engineering; suitable as a Codex implementation brief

---

## 1. Product definition

SIDECHANNEL is a local-first sensing application that turns incidental emissions into one explorable spatial scene.

Instead of giving the user separate RF, sound, temperature, network, or power dashboards, SIDECHANNEL places all observations into a shared coordinate system. The user can move through a room, building, or small outdoor area and see activity appear as fields, trails, points, contours, and events.

The product should answer questions such as:

- Where is activity concentrated right now?
- What changes when a device, appliance, person, or light source turns on?
- Which signals co-occur in the same location and time window?
- Is this observation measured, estimated, stale, or uncertain?
- Can I replay a session and compare two moments without losing provenance?

SIDECHANNEL is an observation and exploration tool. It must not imply that a signal identifies a person, proves a cause, diagnoses a condition, or reveals private content.

### Product promise

> SIDECHANNEL gives incidental activity a place in the world.

### Product shape

Build a desktop-first local application with:

1. A shared spatial scene.
2. A streaming observation model.
3. Pluggable input adapters for sensors and permitted data sources.
4. A clear distinction between measurement, inference, and uncertainty.
5. Session recording and replay.
6. No cloud dependency for the first release.

---

## 2. Target users and jobs to be done

### Primary users

- Curious technical users exploring the invisible activity in a home, studio, workshop, classroom, or lab.
- Makers and researchers prototyping sensor-fusion experiences.
- Facilities and operations teams investigating environmental changes in a bounded space.
- Artists, educators, and exhibit designers creating live spatial visualizations.

### Jobs to be done

- “Show me where the room is active.”
- “Let me see what changes when I switch this device on.”
- “Help me compare the same space at two different times.”
- “Let me add a new sensor without redesigning the application.”
- “Keep the raw source and the visual interpretation traceable.”

### Explicit non-goals

- No covert surveillance.
- No person identification or persistent device tracking by default.
- No raw audio recording by default.
- No decoding of message content, communications, or private network payloads.
- No medical, safety, security, or compliance conclusions.
- No physical actuation or control of appliances, vehicles, robots, or other equipment in v0.1.
- No claim that correlation between channels establishes causality.

---

## 3. Product principles

### One scene, many channels

Every channel is rendered into the same local coordinate frame. A user can toggle channels, but the scene remains the primary object.

### Measured versus inferred

The UI must distinguish:

- measured: directly received from a source;
- derived: computed from one source, such as an audio-band envelope;
- inferred: estimated from multiple observations or a spatial model;
- stale: not updated within the source freshness window;
- unknown: missing, malformed, or below the quality threshold.

### Provenance is visible

Every visible mark can be inspected to reveal source, timestamp, units, calibration, transform, confidence, and processing steps.

### Local-first and fail-closed

The application runs on loopback by default, stores sessions locally, and rejects malformed or unverifiable measurements rather than turning them into confident-looking visuals.

### Calm visual language

The scene should make patterns legible without pretending to be scientific certainty. Use confidence, age, and source badges instead of over-precise values.

### Plugin-shaped inputs

Sensor sources should conform to one normalized contract. Adding a source should not require rewriting the scene, replay, or storage layers.

---

## 4. Release plan

### v0.1 — Local scene explorer

The first shippable version should support:

- A 2D local scene with a user-created rectangular room or imported image/floorplan.
- Manual placement of sensor sources.
- Simulated data generators for RF-like intensity, sound-band activity, temperature, vibration, network throughput, electrical load, Bluetooth presence count, and light flicker.
- Generic JSON-lines and WebSocket ingestion adapters.
- Live map rendering with per-channel toggles.
- A unified activity layer showing cross-channel intensity.
- Sensor/source health, quality, age, and confidence indicators.
- Click-to-inspect provenance.
- Start/stop recording.
- Session replay with a timeline.
- Export of a session and its metadata as JSON.
- Loopback-only runtime with no account or cloud requirement.

The simulator is a first-class development and demo source, not a placeholder. It makes the application testable before hardware integration exists.

### v0.2 — Calibration and comparison

- Guided sensor placement and coordinate calibration.
- Point, line, and area source geometry.
- Baseline recording and anomaly-relative views.
- Side-by-side or split-time comparison.
- Additional adapters for local OS/network telemetry and selected USB/serial sensors.
- Basic 3D extrusion or camera tilt, while preserving the 2D scene as the authoritative coordinate model.

### v0.3 — Extensible field kit

- Adapter SDK with versioned capability descriptors.
- Mobile companion or remote sensor gateway on the local network.
- Multi-room scenes and scene transitions.
- Collaborative local sessions with explicit user opt-in.
- Optional encrypted export/import.

### Later, only with explicit privacy review

- Remote access.
- Cloud sync.
- Persistent Bluetooth or Wi-Fi device identities.
- Raw audio or packet capture.
- Physical control integrations.

---

## 5. Core user experience

### 5.1 First launch

The user sees three choices:

1. Explore a simulated scene.
2. Create a blank scene.
3. Import a previously exported session.

The onboarding explains that the application shows observations and estimates, not identity or intent. It also states that raw audio and network payloads are not collected by default.

### 5.2 Scene workspace

The main workspace contains:

- Center: spatial canvas.
- Left rail: channel and layer controls.
- Right rail: selected source, point, event, or region details.
- Bottom: live/replay timeline, recording controls, and freshness legend.
- Top bar: scene name, runtime status, source count, and session controls.

### 5.3 Spatial canvas

The canvas supports:

- pan and zoom;
- optional grid and scale marker;
- room/floorplan background;
- sensor/source markers;
- heat fields;
- contours or isobands;
- motion trails for changing activity;
- event pulses;
- selected-item inspection;
- a legend showing units, normalization, confidence, and age.

The default map is 2D. A pseudo-3D presentation may be added later, but all data remains anchored to x/y coordinates and an optional z coordinate.

### 5.4 Channel controls

Each channel has:

- visibility toggle;
- color assignment;
- display mode: points, field, contours, trails, or events;
- normalization mode: absolute, source-relative, or baseline-relative;
- unit label;
- freshness window;
- source count;
- quality state.

The unified Activity layer is a weighted composition of channels. It must expose the active weights and never hide the underlying channels.

### 5.5 Inspect panel

When a user selects a visual element, show:

- channel and source name;
- value and unit;
- source timestamp and current age;
- location and spatial uncertainty;
- quality and confidence;
- calibration status;
- whether the value is measured, derived, or inferred;
- processing path;
- related events in the same time window.

### 5.6 Replay

Replay must preserve original timestamps and source metadata. The user can:

- scrub the timeline;
- play at 0.25x, 1x, 2x, and 10x;
- pause on an event;
- toggle channels;
- compare current time with a pinned time;
- inspect the original observation behind a rendered feature.

### 5.7 Failure and uncertainty states

The UI must show an explicit state when:

- a source disconnects;
- the source sends malformed data;
- a measurement is stale;
- units are missing;
- timestamps are invalid;
- calibration is absent;
- values are out of range;
- a transform is not invertible;
- data is too sparse for a field estimate.

Do not silently render a zero value for invalid or missing data.

---

## 6. Supported channel model

SIDECHANNEL uses channel families rather than hard-coding one visualization per sensor.

| Channel | v0.1 representation | Example derived features | Default privacy posture |
|---|---|---|---|
| RF | scalar intensity or band energy | rolling energy, change rate | no decoded content |
| Magnetic field | scalar or vector | magnitude, gradient | local numeric values only |
| Heat | scalar temperature or thermal sample | delta from baseline, gradient | no identity inference |
| Vibration | scalar/vector sample | RMS, peak, band energy | summary features by default |
| Sound | acoustic feature envelope | band energy, onset, loudness proxy | no raw audio persistence |
| Network traffic | rate/count feature | bytes/s, packet count, category | no payload capture |
| Electrical load | power/energy feature | watts, watt-hours, change point | no device control |
| Bluetooth | count/RSSI feature | nearby count, aggregate RSSI | no persistent IDs by default |
| Light flicker | intensity/frequency feature | modulation depth, dominant frequency | numeric features only |

Each source declares which feature types it emits. The renderer does not need to know the hardware model.

---

## 7. Technical architecture

### Recommended stack

- Runtime: Node.js 22+.
- Backend: TypeScript with Fastify or a similarly small HTTP/WebSocket server.
- Frontend: React + TypeScript + Vite.
- Canvas: HTML Canvas or SVG for v0.1; use a scene abstraction so a WebGL renderer can replace it later.
- Persistence: SQLite with a local file and WAL mode.
- Validation: Zod or equivalent runtime schema validation.
- Tests: Vitest for unit/integration tests and Playwright for browser flows.
- Packaging: keep the app runnable as a local web app first; add a Tauri shell only after the core loop is stable.

### Why this shape

The product needs a fast visual iteration loop and a broad adapter surface. A local TypeScript server makes simulated, file, WebSocket, and future native sources share one contract. A thin desktop shell can later provide OS integration without coupling the core product to one operating system.

### High-level data flow

~~~mermaid
flowchart LR
  A[Sensor or permitted source] --> B[Adapter]
  B --> C[Validation and normalization]
  C --> D[Quality and freshness gate]
  D --> E[Feature extraction]
  E --> F[Spatial transform]
  F --> G[Scene state]
  G --> H[Live renderer]
  G --> I[Recorder]
  I --> J[SQLite session store]
  J --> K[Replay engine]
  K --> H
~~~

### Process boundaries

1. adapter: receives source-specific data.
2. ingest: validates and normalizes observations.
3. quality: applies timestamp, unit, range, and freshness rules.
4. features: derives display-ready features without changing provenance.
5. spatial: maps source measurements into the scene coordinate frame.
6. scene: owns the current state and event stream.
7. storage: records raw-normalized observations and metadata.
8. api: exposes local HTTP and WebSocket interfaces.
9. ui: renders state and user actions.

The UI must not directly parse hardware-specific payloads.

---

## 8. Coordinate system and spatial model

### Scene coordinates

Use a right-handed local coordinate system:

- origin: user-defined scene origin;
- x: horizontal axis;
- y: vertical/depth axis in the floor plane;
- z: optional height;
- units: meters by default, with a user-selectable display unit;
- no global location is required.

### Spatial entities

- Scene: coordinate frame, dimensions, background, and display settings.
- SensorPlacement: source anchor and calibration metadata.
- SpatialObservation: an observation after mapping into scene coordinates.
- SpatialRegion: a room area, polygon, or user-defined zone.
- FieldSample: a rendered estimate at a position with uncertainty.
- Event: a time-bounded change or threshold crossing.

### Mapping rules

- A point sensor maps to one position plus a spatial uncertainty radius.
- A directional sensor may map to a ray, cone, or ellipse.
- A mobile sensor maps to a path of point observations.
- An area or ambient sensor maps to a region with no false point precision.
- A field estimate is invalid when there are too few valid samples or when the configured interpolation method is ill-conditioned.

### v0.1 field estimation

Implement an intentionally simple inverse-distance-weighted field:

~~~text
weight_i(p) = 1 / max(distance(p, sensor_i), epsilon)^power
field(p) = sum(weight_i(p) * normalized_value_i)
           / sum(weight_i(p))
~~~

Requirements:

- show the chosen power and search radius in layer settings;
- mask areas outside the configured radius;
- propagate uncertainty from source quality and distance;
- show “insufficient data” instead of fabricating a full-room field;
- keep raw sensor points visible over the field.

Do not call this triangulation or localization unless the source actually provides the necessary measurement model.

---

## 9. Canonical data contracts

Use versioned, JSON-serializable contracts. The following TypeScript shapes are normative for v0.1.

~~~ts
type ChannelKind =
  | 'rf'
  | 'magnetic'
  | 'heat'
  | 'vibration'
  | 'sound'
  | 'network'
  | 'electrical'
  | 'bluetooth'
  | 'light_flicker'
  | 'custom';

type ObservationStatus = 'measured' | 'derived' | 'inferred' | 'stale' | 'rejected';

type Quality = {
  score: number;          // 0..1
  state: 'good' | 'degraded' | 'stale' | 'invalid';
  reasons: string[];
};

type SpatialPoint = {
  x: number;
  y: number;
  z?: number;
  uncertaintyRadius?: number;
};

type Observation = {
  schemaVersion: '0.1';
  id: string;
  sourceId: string;
  channel: ChannelKind;
  timestampMs: number;
  receivedAtMs: number;
  value: number | number[];
  unit: string;
  status: ObservationStatus;
  quality: Quality;
  position?: SpatialPoint;
  feature?: string;
  metadata?: Record<string, string | number | boolean>;
};

type SensorSource = {
  id: string;
  name: string;
  adapterType: string;
  channels: ChannelKind[];
  capabilities: string[];
  sampleRateHz?: number;
  freshnessWindowMs: number;
  privacyMode: 'summary_only' | 'local_numeric' | 'raw_disabled';
  connected: boolean;
  lastSeenAtMs?: number;
};

type SensorPlacement = {
  sourceId: string;
  position: SpatialPoint;
  transform?: {
    rotationDeg?: number;
    scale?: number;
  };
  calibrationState: 'uncalibrated' | 'calibrated' | 'expired';
  calibratedAtMs?: number;
};

type Scene = {
  id: string;
  name: string;
  schemaVersion: '0.1';
  width: number;
  height: number;
  unit: 'm' | 'ft' | 'px';
  backgroundImageRef?: string;
  sources: SensorSource[];
  placements: SensorPlacement[];
};
~~~

### Example normalized observation

~~~json
{
  "schemaVersion": "0.1",
  "id": "obs_01J0X7V8J7E3",
  "sourceId": "sim_rf_01",
  "channel": "rf",
  "timestampMs": 1780000000123,
  "receivedAtMs": 1780000000131,
  "value": -54.2,
  "unit": "dBm",
  "status": "measured",
  "quality": {
    "score": 0.96,
    "state": "good",
    "reasons": []
  },
  "position": {
    "x": 2.4,
    "y": 1.8,
    "uncertaintyRadius": 0.25
  },
  "feature": "band_energy",
  "metadata": {
    "band": "simulated"
  }
}
~~~

### Adapter contract

Every adapter must implement:

~~~ts
interface SourceAdapter {
  readonly type: string;
  describe(): Promise<SensorSource>;
  start(emit: (observation: Observation) => void): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<{ connected: boolean; message?: string }>;
}
~~~

An adapter may emit rejected observations only when the rejection is useful for diagnostics. The scene renderer must never treat a rejected observation as valid data.

### v0.1 adapters

Implement these first:

1. simulator: deterministic seeded scenarios for demos and tests.
2. jsonl: reads normalized observations from a file or standard input.
3. websocket: receives normalized observations over a local WebSocket.
4. manual: lets a user inject a single observation from the UI.

Keep native hardware adapters out of the first milestone. The contract must be ready for them, but the simulator and generic adapters are the acceptance path.

---

## 10. Normalization, quality, and fusion

### Ingestion validation

Reject or quarantine an observation when:

- required fields are missing;
- the schema version is unsupported;
- the timestamp is not finite or is too far in the future;
- the value contains NaN or Infinity;
- a numeric value is outside the source-declared range;
- a unit is missing for a numeric channel;
- the source is unknown;
- the position is malformed;
- an array value has an unsupported dimension.

All rejection reasons must be inspectable in source diagnostics.

### Freshness

Each source declares freshnessWindowMs. A source becomes stale when:

~~~text
now - lastValidObservation.timestampMs > freshnessWindowMs
~~~

Stale data may remain visible in replay or as a faded historical trace, but it must not be included in the live unified activity layer.

### Normalized intensity

Each channel renderer receives both the original value and a normalized display intensity in [0, 1].

Supported v0.1 normalization modes:

- fixed range;
- rolling min/max with clamped bounds;
- baseline-relative z-score, capped for display;
- source-declared percentile mapping.

Display normalization must never overwrite the original value or unit.

### Unified activity layer

The unified layer computes:

~~~text
activity(p, t) = clamp(
  sum(channelWeight[c] * channelIntensity[c](p, t) * confidence[c](p, t)),
  0,
  1
)
~~~

The UI must expose:

- active channel weights;
- excluded or stale channels;
- the confidence contribution;
- whether the result is measured-only or includes inferred fields.

If all channels are stale or invalid, show “No current activity data” rather than a dark or low-intensity field that could be mistaken for an observation.

---

## 11. API and event model

The backend listens on 127.0.0.1 by default.

### HTTP endpoints

~~~text
GET    /api/health
GET    /api/scenes
POST   /api/scenes
GET    /api/scenes/:sceneId
PATCH  /api/scenes/:sceneId
POST   /api/scenes/:sceneId/sources
PATCH  /api/sources/:sourceId
GET    /api/sources/:sourceId/diagnostics
POST   /api/sessions
POST   /api/sessions/:sessionId/stop
GET    /api/sessions/:sessionId
GET    /api/sessions/:sessionId/export
POST   /api/observations
~~~

### WebSocket

ws://127.0.0.1:<port>/ws/live

Server-to-client event types:

~~~ts
type LiveEvent =
  | { type: 'observation.accepted'; observation: Observation }
  | { type: 'observation.rejected'; observationId: string; reasons: string[] }
  | { type: 'source.updated'; source: SensorSource }
  | { type: 'scene.updated'; scene: Scene }
  | { type: 'session.state'; state: 'idle' | 'recording' | 'replaying' };
~~~

The client must be able to reconnect and request a compact current-state snapshot. Do not require a browser refresh after an adapter disconnects.

### Export format

Export one self-contained JSON package:

~~~json
{
  "format": "sidechannel-session",
  "formatVersion": "0.1",
  "scene": {},
  "sources": [],
  "observations": [],
  "events": [],
  "createdAtMs": 0,
  "privacy": {
    "rawAudioIncluded": false,
    "networkPayloadsIncluded": false,
    "persistentDeviceIdsIncluded": false
  }
}
~~~

---

## 12. Persistence model

Use SQLite tables equivalent to:

- scenes
- sources
- placements
- sessions
- observations
- events
- diagnostics

Required indexes:

- observations by session_id, timestamp_ms;
- observations by source_id, timestamp_ms;
- observations by channel, timestamp_ms;
- events by session_id, start_ms.

### Retention defaults

- Live state: memory only.
- Recorded sessions: kept until the user deletes them.
- Raw audio: disabled.
- Network payloads: never stored.
- Device identifiers: ephemeral and opt-in only; aggregate Bluetooth/RF features are the default.

### Deletion

The user must be able to delete a session and its observations from the UI. Deletion should remove the local session records and any session-specific background asset references.

---

## 13. Privacy and security requirements

These are product requirements, not optional polish.

- Bind the server to loopback only by default.
- Do not add cloud accounts, remote telemetry, or analytics in v0.1.
- Make every data source visible in the source list.
- Never store raw audio unless a future version gets explicit opt-in and a separate review.
- Never store network payload contents.
- Avoid persistent MAC addresses, SSIDs, or other direct identifiers by default.
- Provide a source-level privacy mode and show it in the inspect panel.
- Sanitize exported metadata and make export privacy flags explicit.
- Treat input as untrusted; validate before persistence or rendering.
- Use bounded message sizes and rate limits on local WebSocket ingestion.
- Do not enable physical actuation or outbound control messages.

If an implementation later adds network-accessible sensor gateways, require explicit user action to bind beyond loopback and show the listening address prominently.

---

## 14. Visual and interaction specification

### Visual language

- Dark neutral canvas with high-contrast data layers.
- One stable hue per channel; use intensity and opacity for magnitude.
- Confidence shown with edge sharpness, hatch, or a small badge, not only color.
- Staleness shown with fading and a clock icon.
- Rejected/invalid data shown in diagnostics, not as ordinary scene content.
- Avoid red/green-only semantics.

### Accessibility

- Keyboard navigation for all controls.
- Visible focus states.
- Color-safe channel legend with labels and patterns.
- Reduced-motion mode.
- Text alternative for selected observation and current layer summary.
- Screen-reader labels for live/replay status and source health.

### Important empty states

- “No sources connected.”
- “Place a source to begin mapping.”
- “Waiting for valid observations.”
- “Not enough spatial samples for a field.”
- “This source is stale.”
- “This value was rejected and is available in diagnostics.”

---

## 15. Repository and module layout

Use a small monorepo or a single repository with clear package boundaries:

~~~text
sidechannel/
  apps/
    server/
      src/
        api/
        adapters/
        ingest/
        quality/
        features/
        spatial/
        scene/
        storage/
    web/
      src/
        components/
        canvas/
        state/
        hooks/
        styles/
  packages/
    contracts/
    simulator/
    test-fixtures/
  data/
  docs/
  package.json
  README.md
~~~

If the repository is intentionally kept single-package, retain the same conceptual boundaries under src/.

### Suggested front-end components

- AppShell
- SceneCanvas
- SceneToolbar
- ChannelLegend
- LayerControls
- SourceList
- SourceHealthBadge
- InspectorPanel
- Timeline
- SessionControls
- DiagnosticsDrawer
- EmptyState

### Suggested state slices

- sceneState
- sourceState
- liveObservationState
- layerState
- sessionState
- diagnosticsState
- uiState

Keep replay state separate from live ingestion state so replay cannot accidentally write to live sources.

---

## 16. Build milestones

### Milestone 0 — Foundation

Deliver:

- repository and scripts;
- TypeScript configuration;
- shared contracts;
- local server booting on loopback;
- health endpoint;
- minimal browser shell;
- test runner.

Acceptance: a fresh checkout can start the app with documented commands and the browser can load the shell.

### Milestone 1 — Scene and simulator

Deliver:

- scene creation;
- manual source placement;
- deterministic simulator;
- accepted observation stream;
- source list and health state;
- live point rendering.

Acceptance: the simulated scene visibly changes over time and can be reset deterministically with a seed.

### Milestone 2 — Fields and unified activity

Deliver:

- normalization;
- freshness gates;
- inverse-distance field;
- channel toggles;
- unified activity layer;
- confidence and stale styling.

Acceptance: invalid, stale, or insufficient data never appears as confident live activity.

### Milestone 3 — Recording and replay

Deliver:

- session start/stop;
- SQLite persistence;
- timeline;
- replay;
- JSON export/import;
- delete session.

Acceptance: an exported session can be imported into a clean app instance and replayed with original timestamps and source metadata.

### Milestone 4 — Generic adapters and diagnostics

Deliver:

- JSON-lines adapter;
- local WebSocket adapter;
- diagnostics drawer;
- rejection reasons;
- bounded message/rate handling.

Acceptance: external normalized observations can be streamed into the scene without UI changes.

### Milestone 5 — Product hardening

Deliver:

- keyboard and reduced-motion support;
- visual regression coverage;
- performance profiling;
- packaging notes;
- threat/privacy review;
- operator documentation.

Acceptance: the documented smoke test passes on a clean machine and the app remains responsive with the target fixture load.

---

## 17. Performance targets

For the v0.1 simulator fixture:

- 60 FPS target for the canvas with up to 500 visible spatial points.
- Under 250 ms from accepted observation to visible live update under normal load.
- Support 10 sources at 10 Hz each without dropped UI frames.
- Replay scrubbing should update the visible scene within 200 ms for a 10-minute session.
- Keep the default memory footprint reasonable for a desktop utility; profile before setting a hard cap.

If the target is missed, degrade gracefully in this order:

1. reduce field grid resolution;
2. reduce trail length;
3. reduce animation frequency;
4. retain point observations and source health;
5. show a performance warning.

Never silently drop source health or provenance.

---

## 18. Testing strategy

### Unit tests

- contract validation;
- timestamp and freshness rules;
- unit/range validation;
- normalization functions;
- field interpolation;
- uncertainty propagation;
- activity fusion;
- export/import round trip;
- deletion behavior.

### Integration tests

- simulator to WebSocket to UI;
- malformed input to diagnostics;
- source disconnect and reconnect;
- record/replay lifecycle;
- imported session rendering;
- loopback binding check.

### Browser tests

- first-launch simulated scene;
- create scene and place source;
- toggle layers;
- select point and inspect provenance;
- record, replay, and export;
- stale source display;
- insufficient-data empty state;
- keyboard navigation for the main workspace.

### Property-style checks

- normalized intensity always remains in [0, 1];
- rejected observations never enter the live activity layer;
- activity remains bounded in [0, 1];
- invalid timestamps never move the replay cursor;
- export followed by import preserves observation count and source IDs.

### Visual verification

Maintain fixtures for:

- single point source;
- two-source gradient;
- stale source;
- mixed measured/derived channels;
- no data;
- diagnostics open;
- replay paused on event.

---

## 19. Definition of done for v0.1

The implementation is ready for handoff when all of the following are true:

- The app runs locally from documented commands.
- The server binds to loopback by default.
- A user can start with a deterministic simulated scene.
- At least three channel types render through the same scene pipeline, even if all originate from the simulator.
- A user can create a scene, place sources, observe live updates, record, replay, export, import, and delete a session.
- Every visible observation has timestamp, source, unit, quality, and status metadata.
- Malformed and stale data fail closed.
- The unified activity layer reveals its channel weights and excludes stale/invalid data.
- No raw audio, network payloads, or persistent device identities are stored by default.
- Unit, integration, and browser smoke tests pass.
- The README explains the architecture, commands, data model, privacy posture, and adapter extension path.

---

## 20. Codex execution brief

Give Codex the following instructions as the implementation prompt. It is intentionally specific enough to begin without another product-discovery pass.

~~~text
Build SIDECHANNEL, a local-first spatial sensing explorer.

Goal:
Create a desktop-oriented local web application that turns normalized sensor observations into one explorable 2D spatial scene. The first release must work without physical hardware by using a deterministic simulator, while exposing generic JSON-lines and local WebSocket adapters for future sensors.

Required stack:
- Node.js 22+
- TypeScript
- React + Vite
- Fastify or an equivalent small TypeScript HTTP/WebSocket server
- SQLite for recorded sessions
- Zod or equivalent runtime validation
- Vitest for unit/integration tests
- Playwright for browser smoke tests

Hard boundaries:
- Bind to 127.0.0.1 by default.
- No cloud account, analytics, or remote telemetry.
- No physical actuation or outbound control messages.
- No raw audio persistence.
- No network payload capture.
- No persistent Bluetooth/Wi-Fi device identifiers by default.
- Reject malformed, stale, unsupported, or unverifiable observations instead of rendering them as valid activity.

Implement in this order:
1. Set up the repository and scripts.
2. Add shared versioned contracts for Scene, SensorSource, SensorPlacement, Observation, Quality, and LiveEvent.
3. Build the loopback server with /api/health, scene endpoints, observation ingestion, and a WebSocket live stream.
4. Build a deterministic seeded simulator that emits at least RF, sound, heat, vibration, network, electrical, Bluetooth, and light-flicker features at positioned points.
5. Build the React workspace with a 2D scene canvas, channel/layer controls, source list, inspector, timeline, diagnostics, and recording controls.
6. Implement validation, freshness, normalization, inverse-distance field estimation, confidence, and the unified activity layer.
7. Persist sessions to SQLite and implement replay, JSON export/import, and deletion.
8. Add JSON-lines and local WebSocket adapters.
9. Add the required tests and a README.

Important behavior:
- The original measurement and unit must remain inspectable after display normalization.
- The UI must label data as measured, derived, inferred, stale, or rejected.
- The unified activity layer must expose active channel weights and exclude stale/invalid data.
- If there is insufficient data for a field, show an explicit insufficient-data state.
- Keep replay state separate from live ingestion state.
- Render raw point observations above inferred fields.
- Every selected visual element must show source, timestamp, unit, quality, status, location, and processing path.

Use the following canonical observation shape:
{
  schemaVersion: '0.1',
  id: string,
  sourceId: string,
  channel: ChannelKind,
  timestampMs: number,
  receivedAtMs: number,
  value: number | number[],
  unit: string,
  status: 'measured' | 'derived' | 'inferred' | 'stale' | 'rejected',
  quality: { score: number; state: 'good' | 'degraded' | 'stale' | 'invalid'; reasons: string[] },
  position?: { x: number; y: number; z?: number; uncertaintyRadius?: number },
  feature?: string,
  metadata?: Record<string, string | number | boolean>
}

Acceptance checks:
- Fresh checkout starts with documented commands.
- Simulator produces deterministic results for a fixed seed.
- Create a scene, place sources, and see live points and fields.
- Toggle channels and inspect provenance.
- Malformed observations appear only in diagnostics.
- Stale observations are visibly marked and excluded from live unified activity.
- Record, replay, export, import, and delete a session.
- Export/import preserves scene metadata, source IDs, observation count, timestamps, and privacy flags.
- Unit, integration, and browser tests pass.

Before finishing:
- Run the full test suite.
- Run the browser smoke test.
- Verify the server is loopback-only.
- Verify the default export contains no raw audio, network payloads, or persistent device IDs.
- Update README with setup, architecture, privacy, adapter contract, and known limitations.
- Report exactly which acceptance checks passed and which remain unverified.
~~~

---

## 21. Open decisions for a later product review

These do not block v0.1:

- Whether the eventual desktop shell should be Tauri or another host.
- Whether the canonical visual renderer should move from Canvas/SVG to WebGL.
- Which physical sensor kits deserve first-party adapters.
- Whether a scene should support multiple floors or rooms in one session.
- Whether users need a formal calibration workflow for each channel.
- Which derived features are useful enough to standardize across adapters.

The implementation should isolate these decisions behind interfaces rather than prematurely solving them.

