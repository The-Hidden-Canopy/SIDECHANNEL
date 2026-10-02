import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { scenes: [], sessions: [] };
    this.pendingWrites = 0;
  }

  async init(defaultScene) {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = JSON.parse(raw);
    } catch {
      this.state = { scenes: [], sessions: [] };
    }
    if (!this.state.scenes.some((scene) => scene.id === defaultScene.id)) {
      this.state.scenes.push(defaultScene);
      await this.persist();
    }
  }

  async persist() {
    const temporary = this.filePath + '.tmp';
    await writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }

  getScene(sceneId) {
    return this.state.scenes.find((scene) => scene.id === sceneId);
  }

  listScenes() {
    return this.state.scenes.slice();
  }

  async upsertScene(scene) {
    const index = this.state.scenes.findIndex((item) => item.id === scene.id);
    if (index === -1) this.state.scenes.push(scene);
    else this.state.scenes[index] = scene;
    await this.persist();
    return scene;
  }

  listSessions() {
    return this.state.sessions
      .map((session) => ({
        id: session.id,
        sceneId: session.sceneId,
        startedAtMs: session.startedAtMs,
        endedAtMs: session.endedAtMs,
        state: session.state || (session.endedAtMs ? 'completed' : 'recording'),
        observationCount: session.observations.length
      }))
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
  }

  getSession(sessionId) {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  async createSession(sceneId) {
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId,
      startedAtMs: Date.now(),
      endedAtMs: null,
      observations: [],
      events: []
    };
    this.state.sessions.push(session);
    await this.persist();
    return session;
  }

  async appendObservation(sessionId, observation) {
    const session = this.getSession(sessionId);
    if (!session || session.endedAtMs) return;
    session.observations.push(observation);
    this.pendingWrites += 1;
    if (this.pendingWrites >= 20) {
      this.pendingWrites = 0;
      await this.persist();
    }
  }

  async finishSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.endedAtMs = Date.now();
    await this.persist();
    return session;
  }

  async deleteSession(sessionId) {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => session.id !== sessionId);
    if (this.state.sessions.length !== before) await this.persist();
    return before !== this.state.sessions.length;
  }

  async pruneSessions(keep = 0, { protectedIds = [] } = {}) {
    const boundedKeep = Math.max(0, Math.floor(Number(keep)));
    const protectedSet = new Set(protectedIds);
    const candidates = this.listSessions().filter((session) =>
      session.state !== 'recording' && !protectedSet.has(session.id)
    );
    const deletedIds = candidates.slice(boundedKeep).map((session) => session.id);
    if (deletedIds.length) {
      const deletedSet = new Set(deletedIds);
      this.state.sessions = this.state.sessions.filter((session) => !deletedSet.has(session.id));
      await this.persist();
    }
    return {
      keep: boundedKeep,
      eligibleCount: candidates.length,
      deletedIds,
      remaining: this.listSessions()
    };
  }

  async importPackage(packageData) {
    const session = {
      id: 'sess_' + randomUUID(),
      sceneId: packageData.scene?.id || 'scene_main',
      startedAtMs: packageData.createdAtMs || Date.now(),
      endedAtMs: Date.now(),
      observations: Array.isArray(packageData.observations) ? packageData.observations : [],
      events: Array.isArray(packageData.events) ? packageData.events : []
    };
    if (packageData.scene) await this.upsertScene(packageData.scene);
    this.state.sessions.push(session);
    await this.persist();
    return session;
  }
}
