import { DatabaseSync } from 'node:sqlite';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
        ended_at_ms INTEGER
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
      CREATE INDEX IF NOT EXISTS observations_by_session_time
        ON observations(session_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS events_by_session_start
        ON events(session_id, start_ms);
    `);

    if (!databaseExisted && this.legacyJsonPath && await exists(this.legacyJsonPath)) {
      await this.migrateJson(await readFile(this.legacyJsonPath, 'utf8'));
    }
    if (!this.getScene(defaultScene.id)) this.upsertScene(defaultScene);
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
      SELECT id, scene_id, started_at_ms, ended_at_ms FROM sessions WHERE id = ?
    `).get(sessionId);
    if (!row) return undefined;
    return {
      id: row.id,
      sceneId: row.scene_id,
      startedAtMs: row.started_at_ms,
      endedAtMs: row.ended_at_ms,
      observations: this.db.prepare(`
        SELECT payload FROM observations WHERE session_id = ? ORDER BY timestamp_ms, rowid
      `).all(sessionId).map((item) => decode(item.payload, null)).filter(Boolean),
      events: this.db.prepare(`
        SELECT payload FROM events WHERE session_id = ? ORDER BY start_ms, rowid
      `).all(sessionId).map((item) => decode(item.payload, null)).filter(Boolean)
    };
  }

  createSession(sceneId) {
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId,
      startedAtMs: Date.now(),
      endedAtMs: null,
      observations: [],
      events: []
    };
    this.db.prepare(`
      INSERT INTO sessions (id, scene_id, started_at_ms, ended_at_ms) VALUES (?, ?, ?, NULL)
    `).run(session.id, session.sceneId, session.startedAtMs);
    return session;
  }

  appendObservation(sessionId, observation) {
    const session = this.db.prepare('SELECT id FROM sessions WHERE id = ? AND ended_at_ms IS NULL').get(sessionId);
    if (!session) return;
    this.insertObservation(sessionId, observation);
  }

  appendEvent(sessionId, event) {
    const session = this.db.prepare('SELECT id FROM sessions WHERE id = ? AND ended_at_ms IS NULL').get(sessionId);
    if (!session) return;
    this.insertEvent(sessionId, event);
  }

  finishSession(sessionId) {
    const endedAtMs = Date.now();
    const result = this.db.prepare(`
      UPDATE sessions SET ended_at_ms = COALESCE(ended_at_ms, ?) WHERE id = ?
    `).run(endedAtMs, sessionId);
    return result.changes ? this.getSession(sessionId) : null;
  }

  deleteSession(sessionId) {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
  }

  importPackage(packageData) {
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId: packageData.scene?.id || 'scene_main',
      startedAtMs: packageData.createdAtMs || Date.now(),
      endedAtMs: Date.now(),
      observations: Array.isArray(packageData.observations) ? packageData.observations : [],
      events: Array.isArray(packageData.events) ? packageData.events : []
    };
    if (packageData.scene) this.upsertScene(packageData.scene);
    this.db.prepare(`
      INSERT INTO sessions (id, scene_id, started_at_ms, ended_at_ms) VALUES (?, ?, ?, ?)
    `).run(session.id, session.sceneId, session.startedAtMs, session.endedAtMs);
    for (const observation of session.observations) this.insertObservation(session.id, observation);
    for (const event of session.events) this.insertEvent(session.id, event);
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
      this.db.prepare(`
        INSERT OR IGNORE INTO sessions (id, scene_id, started_at_ms, ended_at_ms)
        VALUES (?, ?, ?, ?)
      `).run(
        session.id,
        session.sceneId || 'scene_main',
        session.startedAtMs || Date.now(),
        session.endedAtMs ?? null
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
    if (!observation?.id) return;
    this.db.prepare(`
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
  }

  insertEvent(sessionId, event) {
    if (!event?.id) return;
    this.db.prepare(`
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
  }
}
