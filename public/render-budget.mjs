const RENDER_BUDGETS = [
  {
    maxObservations: 180,
    cols: 22,
    rows: 18,
    trailLimit: 24,
    eventLimit: 12,
    label: 'full visual detail',
    warning: null
  },
  {
    maxObservations: 420,
    cols: 18,
    rows: 14,
    trailLimit: 16,
    eventLimit: 10,
    label: 'reduced field detail',
    warning: 'Dense scene: field grid and trail length reduced; point observations and source health remain visible.'
  },
  {
    maxObservations: 900,
    cols: 14,
    rows: 11,
    trailLimit: 10,
    eventLimit: 8,
    label: 'conservative visual detail',
    warning: 'Very dense scene: field grid, trails, and event overlay reduced; point observations and source health remain visible.'
  },
  {
    maxObservations: Number.POSITIVE_INFINITY,
    cols: 10,
    rows: 8,
    trailLimit: 6,
    eventLimit: 5,
    label: 'capped visual detail',
    warning: 'Scene exceeds the visual budget: field grid, trails, and event overlay capped; point observations and source health remain visible.'
  }
];

export function renderBudgetForObservationCount(count) {
  const numeric = Number(count);
  const normalized = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  const budget = RENDER_BUDGETS.find((candidate) => normalized <= candidate.maxObservations) || RENDER_BUDGETS.at(-1);
  return { ...budget, observationCount: normalized };
}

export const RENDER_BUDGET_LIMITS = Object.freeze(RENDER_BUDGETS.map(({ maxObservations, cols, rows, trailLimit, eventLimit }) => ({
  maxObservations, cols, rows, trailLimit, eventLimit
})));
