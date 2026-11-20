// The steps of the Research and Design tabs, in story order (→ walks them across both tabs), and which view draws
// each one: 'conops' is the stepped basin map (src/s3/conops), 'coverage' the alerting chain (src/s3/coverage).
export const STEPS = {
  research: [['why', 'Why'], ['today', 'Today']],
  design: [['what', 'S-3 system'], ['hear', 'Who must hear it'], ['sound', 'How far a voice carries']],
};
export const STORY = [...STEPS.research, ...STEPS.design].map(([s]) => s);
export const TAB_OF = Object.fromEntries(Object.entries(STEPS).flatMap(([tab, list]) => list.map(([s]) => [s, tab])));
export const VIEW_OF = { why: 'conops', today: 'conops', what: 'conops', hear: 'coverage', sound: 'coverage' };
export const TITLE = {
  why: 'Research: why the basin needs S-3', today: 'Research: today, without S-3',
  what: 'Design: what we build, where, and how many', hear: 'Design: who must hear the alert', sound: 'Design: how far a voice carries',
};

// The step buttons for the current step's tab (clicks are handled by src/main.js through data-co-step).
export function stepBar(step) {
  const tab = TAB_OF[step], btn = ([s, label]) => `<button data-co-step="${s}" aria-pressed="${s === step}">${label}</button>`;
  const next = tab === 'research' ? `<button data-co-step="what" aria-pressed="false">Design →</button>` : '';
  return `<div class="seg co-step" role="group" aria-label="${tab === 'research' ? 'Research' : 'Design'} step (← →)">${STEPS[tab].map(btn).join('')}${next}</div>`;
}
