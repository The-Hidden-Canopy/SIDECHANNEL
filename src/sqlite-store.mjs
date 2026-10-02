import { DatabaseSync } from 'node:sqlite';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { computeJournalDigest } from './journal.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function encode(value) {
  return JSON.stringify(value ?? null);
}

function decode(value, fallback) {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function digest(value) {
  return createHash('sha256').update(encode(value)).digest('hex');
}

export function computeSnapshotDigest({
  sceneSnapshot,
  sourceRegistrySnapshot,
  calibrationRegistrySnapshot,
  transformGraphSnapshot,
  runtimeBuildId,
  schemaSetDigest
}) {
  return digest({
    sceneSnapshot,
    sourceRegistrySnapshot,
    calibrationRegistrySnapshot,
    transformGraphSnapshot,
    runtimeBuildId,
    schemaSetDigest
  });
}

export class SqliteStore {
  constructor(filePath, { legacyJsonPath = null } = {}) {
    this.filePath = filePath;
    this.legacyJsonPath = legacyJsonPath;
    this.db = null;
  }

  async init(defaultScene) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const databaseExisted = await exists(this.filePath);
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER,
        scene_snapshot TEXT,
        source_registry_snapshot TEXT,
        calibration_registry_snapshot TEXT,
        transform_graph_snapshot TEXT,
        runtime_build_id TEXT,
        schema_set_digest TEXT,
        snapshot_digest TEXT
      );
      CREATE TABLE IF NOT EXISTS observations (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS journal (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        previous_digest TEXT,
        event_digest TEXT NOT NULL,
        PRIMARY KEY (session_id, sequence),
        UNIQUE (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS observations_by_session_time
        ON observations(session_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS events_by_session_start
        ON events(session_id, start_ms);
      CREATE INDEX IF NOT EXISTS journal_by_session_sequence
        ON journal(session_id, sequence);
    `);
    this.ensureSessionSnapshotColumns();

    if (!databaseExisted && this.legacyJsonPath && await exists(this.legacyJsonPath)) {
      await this.migrateJson(await readFile(this.legacyJsonPath, 'utf8'));
    }
    if (!this.getScene(defaultScene.id)) this.upsertScene(defaultScene);
  }

  ensureSessionSnapshotColumns() {
    const columns = [
      ['scene_snapshot', 'TEXT'],
      ['source_registry_snapshot', 'TEXT'],
      ['calibration_registry_snapshot', 'TEXT'],
      ['transform_graph_snapshot', 'TEXT'],
      ['runtime_build_id', 'TEXT'],
      ['schema_set_digest', 'TEXT'],
      ['snapshot_digest', 'TEXT']
    ];
    for (const [name, type] of columns) {
      try {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
      } catch (error) {
        if (!String(error.message).toLowerCase().includes('duplicate column')) throw error;
      }
    }
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

  getScene(sceneId) {
    const row = this.db.prepare('SELECT payload FROM scenes WHERE id = ?').get(sceneId);
    return row ? decode(row.payload, null) : undefined;
  }

  listScenes() {
    return this.db.prepare('SELECT payload FROM scenes ORDER BY id').all()
      .map((row) => decode(row.payload, null))
      .filter(Boolean);
  }

  upsertScene(scene) {
    this.db.prepare(`
      INSERT INTO scenes (id, payload) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
    `).run(scene.id, encode(scene));
    return scene;
  }

  listSessions() {
    return this.db.prepare(`
      SELECT sessions.id, sessions.scene_id, sessions.started_at_ms, sessions.ended_at_ms,
        COUNT(observations.id) AS observation_count
      FROM sessions
      LEFT JOIN observations ON observations.session_id = sessions.id
      GROUP BY sessions.id
      ORDER BY sessions.started_at_ms DESC
    `).all().map((row) => ({
      id: row.id,
      sceneId: row.scene_id,
      startedAtMs: row.started_at_ms,
      endedAtMs: row.ended_at_ms,
      observationCount: Number(row.observation_count)
    }));
  }

  getSession(sessionId) {
    const row = this.db.prepare(`
      SELECT id, scene_id, started_at_ms, ended_at_ms,
        scene_snapshot, source_registry_snapshot, calibration_registry_snapshot,
        transform_graph_snapshot, runtime_build_id, schema_set_digest, snapshot_digest
      FROM sessions WHERE id = ?
    `).get(sessionId);
    if (!row) return undefined;
    return {
      id: row.id,
      sceneId: row.scene_id,
      startedAtMs: row.started_at_ms,
      endedAtMs: row.ended_at_ms,
      sceneSnapshot: decode(row.scene_snapshot, null),
      sourceRegistrySnapshot: decode(row.source_registry_snapshot, null),
      calibrationRegistrySnapshot: decode(row.calibration_registry_snapshot, null),
      transformGraphSnapshot: decode(row.transform_graph_snapshot, null),
      runtimeBuildId: row.runtime_build_id || null,
      schemaSetDigest: row.schema_set_digest || null,
      snapshotDigest: row.snapshot_digest || null,
      snapshotComplete: Boolean(
        row.scene_snapshot && row.source_registry_snapshot && row.transform_graph_snapshot
      ),
      observations: this.db.prepare(`
        SELECT payload FROM observations WHERE session_id = ? ORDER BY timestamp_ms, rowid
      `).all(sessionId).map((item) => decode(item.payload, null)).filter(Boolean),
      events: this.db.prepare(`
        SELECT payload FROM events WHERE session_id = ? ORDER BY start_ms, rowid
      `).all(sessionId).map((item) => decode(item.payload, null)).filter(Boolean),
      journal: this.db.prepare(`
        SELECT id, session_id, sequence, timestamp_ms, type, payload, previous_digest, event_digest
        FROM journal WHERE session_id = ? ORDER BY sequence
      `).all(sessionId).map((item) => ({
        id: item.id,
        sessionId: item.session_id,
        sequence: item.sequence,
        timestampMs: item.timestamp_ms,
        type: item.type,
        payload: decode(item.payload, null),
        previousDigest: item.previous_digest,
        eventDigest: item.event_digest
      }))
    };
  }

  createSession(sceneId, context = {}) {
    const scene = context.scene || this.getScene(sceneId) || { id: sceneId, sources: [], placements: [] };
    const sceneSnapshot = context.scene || scene;
    const sourceRegistrySnapshot = context.sources || scene.sources || [];
    const calibrationRegistrySnapshot = context.calibrations || scene.calibrations ||
      sourceRegistrySnapshot.map((source) => ({
        sourceId: source.id,
        calibrationState: source.calibrationState || 'unknown',
        calibratedAtMs: source.calibratedAtMs || null
      }));
    const transformGraphSnapshot = context.transformGraph || scene.transformGraph || {
      schemaVersion: '0.1',
      placements: scene.placements || []
    };
    const runtimeBuildId = context.runtimeBuildId || 'sidechannel-node-reference';
    const schemaSetDigest = context.schemaSetDigest || digest({ observation: '0.1', event: '0.1' });
    const snapshotDigest = digest({
      sceneSnapshot,
      sourceRegistrySnapshot,
      calibrationRegistrySnapshot,
      transformGraphSnapshot,
      runtimeBuildId,
      schemaSetDigest
    });
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId,
      startedAtMs: Date.now(),
      endedAtMs: null,
      sceneSnapshot,
      sourceRegistrySnapshot,
      calibrationRegistrySnapshot,
      transformGraphSnapshot,
      runtimeBuildId,
      schemaSetDigest,
      snapshotDigest,
      snapshotComplete: true,
      observations: [],
      events: []
    };
    this.db.prepare(`
      INSERT INTO sessions (
        id, scene_id, started_at_ms, ended_at_ms, scene_snapshot,
        source_registry_snapshot, calibration_registry_snapshot, transform_graph_snapshot,
        runtime_build_id, schema_set_digest, snapshot_digest
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.sceneId,
      session.startedAtMs,
      encode(sceneSnapshot),
      encode(sourceRegistrySnapshot),
      encode(calibrationRegistrySnapshot),
      encode(transformGraphSnapshot),
      runtimeBuildId,
      schemaSetDigest,
      snapshotDigest
    );
    this.appendJournal(session.id, 'SessionOpened', { snapshotDigest });
    return session;
  }

  appendObservation(sessionId, observation) {
    const session = this.db.prepare('SELECT id FROM sessions WHERE id = ? AND ended_at_ms IS NULL').get(sessionId);
    if (!session) return;
    if (this.insertObservation(sessionId, observation)) {
      this.appendJournal(sessionId, 'ObservationAdmitted', {
        observationId: observation.id,
        sequence: observation.sequence || null
      }, observation.admittedAtMs || observation.receivedAtMs || Date.now());
    }
  }

  appendEvent(sessionId, event) {
    const session = this.db.prepare('SELECT id FROM sessions WHERE id = ? AND ended_at_ms IS NULL').get(sessionId);
    if (!session) return;
    if (this.insertEvent(sessionId, event)) {
      this.appendJournal(sessionId, 'EventDerived', { eventId: event.id }, event.startMs || Date.now());
    }
  }

  finishSession(sessionId) {
    const endedAtMs = Date.now();
    const result = this.db.prepare(`
      UPDATE sessions SET ended_at_ms = COALESCE(ended_at_ms, ?) WHERE id = ?
    `).run(endedAtMs, sessionId);
    if (!result.changes) return null;
    this.appendJournal(sessionId, 'SessionClosed', { endedAtMs }, endedAtMs);
    return this.getSession(sessionId);
  }

  deleteSession(sessionId) {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
  }

  importPackage(packageData) {
    const sceneSnapshot = packageData.sceneSnapshot || packageData.scene || null;
    const sourceRegistrySnapshot = packageData.sourceRegistrySnapshot || packageData.sources || sceneSnapshot?.sources || [];
    const calibrationRegistrySnapshot = packageData.calibrationRegistrySnapshot || sceneSnapshot?.calibrations || [];
    const transformGraphSnapshot = packageData.transformGraphSnapshot || sceneSnapshot?.transformGraph || {
      schemaVersion: '0.1',
      placements: sceneSnapshot?.placements || []
    };
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId: sceneSnapshot?.id || 'scene_main',
      startedAtMs: packageData.createdAtMs || Date.now(),
      endedAtMs: Date.now(),
      sceneSnapshot,
      sourceRegistrySnapshot,
      calibrationRegistrySnapshot,
      transformGraphSnapshot,
      runtimeBuildId: packageData.runtimeBuildId || 'imported-package',
      schemaSetDigest: packageData.schemaSetDigest || null,
      snapshotDigest: packageData.snapshotDigest || null,
      snapshotComplete: Boolean(sceneSnapshot),
      observations: Array.isArray(packageData.observations) ? packageData.observations : [],
      events: Array.isArray(packageData.events) ? packageData.events : []
    };
    if (sceneSnapshot) this.upsertScene(sceneSnapshot);
    this.db.prepare(`
      INSERT INTO sessions (
        id, scene_id, started_at_ms, ended_at_ms, scene_snapshot,
        source_registry_snapshot, calibration_registry_snapshot, transform_graph_snapshot,
        runtime_build_id, schema_set_digest, snapshot_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.sceneId,
      session.startedAtMs,
      session.endedAtMs,
      encode(sceneSnapshot),
      encode(sourceRegistrySnapshot),
      encode(calibrationRegistrySnapshot),
      encode(transformGraphSnapshot),
      session.runtimeBuildId,
      session.schemaSetDigest,
      session.snapshotDigest
    );
    for (const observation of session.observations) this.insertObservation(session.id, observation);
    for (const event of session.events) this.insertEvent(session.id, event);
    this.appendJournal(session.id, 'ImportAccepted', {
      originalSessionId: packageData.sessionId || null,
      sourcePackageDigest: packageData.snapshotDigest || null
    }, session.startedAtMs);
    return session;
  }

  async migrateJson(raw) {
    let legacy;
    try {
      legacy = JSON.parse(raw);
    } catch {
      return;
    }
    for (const scene of Array.isArray(legacy.scenes) ? legacy.scenes : []) {
      if (scene?.id) this.upsertScene(scene);
    }
    for (const session of Array.isArray(legacy.sessions) ? legacy.sessions : []) {
      if (!session?.id) continue;
      const sceneSnapshot = legacy.scenes?.find((scene) => scene.id === session.sceneId) || null;
      const sourceRegistrySnapshot = sceneSnapshot?.sources || [];
      const transformGraphSnapshot = {
        schemaVersion: '0.1',
        placements: sceneSnapshot?.placements || []
      };
      this.db.prepare(`
        INSERT OR IGNORE INTO sessions (
          id, scene_id, started_at_ms, ended_at_ms, scene_snapshot,
          source_registry_snapshot, calibration_registry_snapshot, transform_graph_snapshot,
          runtime_build_id, schema_set_digest, snapshot_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.sceneId || 'scene_main',
        session.startedAtMs || Date.now(),
        session.endedAtMs ?? null,
        encode(sceneSnapshot),
        encode(sourceRegistrySnapshot),
        encode([]),
        encode(transformGraphSnapshot),
        'legacy-json-migration',
        null,
        null
      );
      for (const observation of Array.isArray(session.observations) ? session.observations : []) {
        this.insertObservation(session.id, observation);
      }
      for (const event of Array.isArray(session.events) ? session.events : []) {
        this.insertEvent(session.id, event);
      }
    }
  }

  insertObservation(sessionId, observation) {
    if (!observation?.id) return false;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO observations
        (session_id, id, timestamp_ms, source_id, channel, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      observation.id,
      observation.timestampMs || 0,
      observation.sourceId || 'unknown',
      observation.channel || 'unknown',
      encode(observation)
    );
    return result.changes > 0;
  }

  insertEvent(sessionId, event) {
    if (!event?.id) return false;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events
        (session_id, id, start_ms, end_ms, type, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      event.id,
      event.startMs || event.timestampMs || 0,
      event.endMs ?? null,
      event.type || 'event',
      encode(event)
    );
    return result.changes > 0;
  }

  appendJournal(sessionId, type, payload = {}, timestampMs = Date.now()) {
    const previous = this.db.prepare(`
      SELECT sequence, event_digest FROM journal WHERE session_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(sessionId);
    const sequence = (previous?.sequence || 0) + 1;
    const id = 'journal_' + randomUUID();
    const previousDigest = previous?.event_digest || null;
    const eventDigest = computeJournalDigest({ sessionId, sequence, timestampMs, type, payload, previousDigest });
    this.db.prepare(`
      INSERT INTO journal
        (session_id, id, sequence, timestamp_ms, type, payload, previous_digest, event_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, id, sequence, timestampMs, type, encode(payload), previousDigest, eventDigest);
    return { id, sessionId, sequence, timestampMs, type, payload, previousDigest, eventDigest };
  }
}
