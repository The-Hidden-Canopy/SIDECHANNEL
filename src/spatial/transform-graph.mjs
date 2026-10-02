import { randomUUID } from 'node:crypto';

export const MAX_TRANSFORM_EDGES = 256;
export const MAX_FRAME_NAME_LENGTH = 128;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class TransformGraph {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.revision = 0;
    this.edges = [];
  }

  publish(input = {}) {
    const fromFrame = typeof input.fromFrame === 'string' ? input.fromFrame.trim() : '';
    const toFrame = typeof input.toFrame === 'string' ? input.toFrame.trim() : '';
    if (fromFrame.length === 0 || fromFrame.length > MAX_FRAME_NAME_LENGTH) throw new Error('fromFrame is required and bounded');
    if (toFrame.length === 0 || toFrame.length > MAX_FRAME_NAME_LENGTH) throw new Error('toFrame is required and bounded');
    if (fromFrame === toFrame) throw new Error('transform frame cycle is not allowed');
    if (this.edges.length >= MAX_TRANSFORM_EDGES) throw new Error('transform graph edge limit reached');
    const translation = input.translation || { x: 0, y: 0, z: 0 };
    if (![translation.x, translation.y, translation.z].every((value) => finite(value))) {
      throw new Error('translation must contain finite x, y, and z');
    }
    const edge = {
      transformId: input.transformId || 'transform_' + randomUUID(),
      fromFrame,
      toFrame,
      revision: this.revision + 1,
      translation: { ...translation },
      rotation: finite(input.rotation) ? input.rotation : 0,
      scale: finite(input.scale) && input.scale > 0 ? input.scale : 1,
      uncertainty: input.uncertainty || {},
      calibrationRef: input.calibrationRef || null,
      validFrom: input.validFrom ?? this.clock(),
      validUntil: input.validUntil ?? null
    };
    if (this.findPath(edge.toFrame, edge.fromFrame)) throw new Error('transform graph cycle is not allowed');
    this.revision = edge.revision;
    this.edges.push(edge);
    return clone(edge);
  }

  snapshot() {
    return { revision: this.revision, edges: clone(this.edges) };
  }

  findPath(fromFrame, toFrame) {
    if (fromFrame === toFrame) return [];
    const queue = [{ frame: fromFrame, edges: [] }];
    const visited = new Set([fromFrame]);
    while (queue.length > 0) {
      const current = queue.shift();
      const outgoing = this.edges
        .filter((edge) => edge.fromFrame === current.frame)
        .sort((left, right) => right.revision - left.revision);
      for (const edge of outgoing) {
        if (visited.has(edge.toFrame)) continue;
        const path = [...current.edges, edge];
        if (edge.toFrame === toFrame) return path;
        visited.add(edge.toFrame);
        queue.push({ frame: edge.toFrame, edges: path });
      }
    }
    return null;
  }

  resolve(fromFrame, toFrame) {
    const path = this.findPath(fromFrame, toFrame);
    return path === null ? null : { revision: this.revision, edges: clone(path) };
  }
}
