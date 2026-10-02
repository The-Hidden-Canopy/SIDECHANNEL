import { createHash, randomUUID } from 'node:crypto';

function encode(value) {
  return JSON.stringify(value ?? null);
}

export function computeJournalDigest({ sessionId, sequence, timestampMs, type, payload, previousDigest }) {
  return createHash('sha256').update(encode({
    sessionId,
    sequence,
    timestampMs,
    type,
    payload,
    previousDigest: previousDigest || null
  })).digest('hex');
}

export class HashChainJournal {
  constructor({ sessionId, clock = () => Date.now(), idFactory = () => randomUUID() } = {}) {
    this.sessionId = sessionId || 'session_unknown';
    this.clock = clock;
    this.idFactory = idFactory;
    this.events = [];
  }

  append(type, payload = {}, timestampMs = this.clock()) {
    const previous = this.events[this.events.length - 1];
    const event = {
      id: 'journal_' + this.idFactory(),
      sessionId: this.sessionId,
      sequence: this.events.length + 1,
      timestampMs,
      type,
      payload,
      previousDigest: previous?.eventDigest || null
    };
    event.eventDigest = computeJournalDigest(event);
    this.events.push(event);
    return { ...event };
  }

  verify(events = this.events) {
    let previousDigest = null;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sessionId !== this.sessionId || event.sequence !== index + 1) {
        return { ok: false, index, reason: 'journal sequence or session mismatch' };
      }
      if ((event.previousDigest || null) !== previousDigest) {
        return { ok: false, index, reason: 'journal previous digest mismatch' };
      }
      const expected = computeJournalDigest(event);
      if (expected !== event.eventDigest) return { ok: false, index, reason: 'journal event digest mismatch' };
      previousDigest = event.eventDigest;
    }
    return { ok: true, eventCount: events.length, tailDigest: previousDigest };
  }
}
