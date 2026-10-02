import { randomUUID } from 'node:crypto';

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
    if (typeof input.fromFrame !== 'string' || input.fromFrame.length === 0) throw new Error('fromFrame is required');
    if (typeof input.toFrame !== 'string' || input.toFrame.length === 0) throw new Error('toFrame is required');
    if (input.fromFrame === input.toFrame) throw new Error('transform frame cycle is not allowed');
    const translation = input.translation || { x: 0, y: 0, z: 0 };
    if (![translation.x, translation.y, translation.z].every((value) => finite(value))) {
      throw new Error('translation must contain finite x, y, and z');
    }
    const edge = {
      transformId: input.transformId || 'transform_' + randomUUID(),
      fromFrame: input.fromFrame,
      toFrame: input.toFrame,
      revision: this.revision + 1,
      translation: { ...translation },
      rotation: finite(input.rotation) ? input.rotation : 0,
      scale: finite(input.scale) && input.scale > 0 ? input.scale : 1,
      uncertainty: input.uncertainty || {},
      calibrationRef: input.calibrationRef || null,
      validFrom: input.validFrom ?? this.clock(),
      validUntil: input.validUntil ?? null
    };
    const createsReverse = this.edges.some((current) =>
      current.fromFrame === edge.toFrame && current.toFrame === edge.fromFrame
    );
    if (createsReverse) throw new Error('transform graph cycle is not allowed');
    this.revision = edge.revision;
    this.edges.push(edge);
    return clone(edge);
  }

  snapshot() {
    return { revision: this.revision, edges: clone(this.edges) };
  }

  resolve(fromFrame, toFrame) {
    if (fromFrame === toFrame) return { revision: this.revision, edges: [] };
    const edge = this.edges.find((current) => current.fromFrame === fromFrame && current.toFrame === toFrame);
    return edge ? { revision: edge.revision, edges: [clone(edge)] } : null;
  }
}
