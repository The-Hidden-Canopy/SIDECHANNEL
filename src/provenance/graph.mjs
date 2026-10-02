import { isPlainObject } from '../contracts.mjs';

export const PROVENANCE_RELATIONS = Object.freeze([
  'measured_from',
  'derived_from',
  'calibrated_by',
  'transformed_by',
  'synchronized_with',
  'imported_from'
]);

export function normalizeProvenance(value) {
  if (value === undefined) return { ok: true, edges: [] };
  if (!Array.isArray(value)) return { ok: false, reasons: [{ id: 'provenance.array', message: 'provenance must be an array' }] };
  const reasons = [];
  const edges = [];
  value.forEach((edge, index) => {
    if (!isPlainObject(edge)) {
      reasons.push({ id: 'provenance.object', message: 'provenance edge ' + index + ' must be an object' });
      return;
    }
    if (typeof edge.parentId !== 'string' || edge.parentId.length === 0) {
      reasons.push({ id: 'provenance.parentId', message: 'provenance edge ' + index + ' requires parentId' });
    }
    if (!PROVENANCE_RELATIONS.includes(edge.relation)) {
      reasons.push({ id: 'provenance.relation', message: 'provenance edge ' + index + ' has an unsupported relation' });
    }
    if (!reasons.some((reason) => reason.message.includes('edge ' + index))) {
      edges.push({ parentId: edge.parentId, relation: edge.relation });
    }
  });
  return reasons.length ? { ok: false, reasons } : { ok: true, edges };
}
