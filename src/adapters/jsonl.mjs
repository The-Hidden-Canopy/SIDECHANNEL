import { createInterface } from 'node:readline';

export async function consumeJsonLines(readable, emit, options = {}) {
  const lineReader = createInterface({ input: readable, crlfDelay: Infinity });
  const errors = [];
  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (Buffer.byteLength(trimmed, 'utf8') > (options.maxLineBytes || 64_000)) {
      const diagnostic = { line: trimmed.slice(0, 200), message: 'adapter line exceeds declared byte limit' };
      errors.push(diagnostic);
      if (options.onError) options.onError(diagnostic);
      continue;
    }
    try {
      emit(JSON.parse(trimmed));
    } catch (error) {
      const diagnostic = { line: trimmed.slice(0, 200), message: error.message };
      errors.push(diagnostic);
      if (options.onError) options.onError(diagnostic);
    }
  }
  return { errors };
}

export class JsonlAdapter {
  constructor(readable, descriptor = {}) {
    this.readable = readable;
    this.descriptor = {
      id: descriptor.id || 'jsonl_source',
      name: descriptor.name || 'JSON-lines source',
      adapterType: 'jsonl',
      channels: descriptor.channels || [],
      capabilities: descriptor.capabilities || ['normalized_observation'],
      freshnessWindowMs: descriptor.freshnessWindowMs || 2000,
      privacyMode: descriptor.privacyMode || 'local_numeric',
      connected: false
    };
    this.task = null;
  }

  describe() {
    return Promise.resolve({ ...this.descriptor });
  }

  start(emit) {
    this.descriptor.connected = true;
    this.task = consumeJsonLines(this.readable, emit, {
      onError: (diagnostic) => {
        if (this.onDiagnostic) this.onDiagnostic(diagnostic);
      }
    }).finally(() => {
      this.descriptor.connected = false;
    });
    return this.task;
  }

  stop() {
    if (this.readable && typeof this.readable.destroy === 'function') this.readable.destroy();
    return Promise.resolve();
  }

  health() {
    return Promise.resolve({ connected: this.descriptor.connected });
  }
}
