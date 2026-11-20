// The steps of the Research and Design tabs, in story order (→ walks them across both tabs), and which view draws
// each one: 'conops' is the stepped basin map (src/s3/conops), 'coverage' the alerting-chain explainers
// (src/s3/coverage). The story is one chain: why → today → where speakers and receivers go → the ranger stations
// they need → the S-3 network those stations join. The explainers open from the speakers step, outside the chain.
export const STEPS = {
  research: [['why', 'Why'], ['today', 'Today']],
  design: [['alerts', 'Speakers & receivers'], ['stations', 'Ranger stations'], ['what', 'S-3 network']],
};
export const DETAIL = { hear: 'Who must hear it', sound: 'How far a voice carries' }; // Design tab, explainers
export const STORY = [...STEPS.research, ...STEPS.design].map(([s]) => s);
export const TAB_OF = {
  ...Object.fromEntries(Object.entries(STEPS).flatMap(([tab, list]) => list.map(([s]) => [s, tab]))),
  ...Object.fromEntries(Object.keys(DETAIL).map(s => [s, 'design'])),
};
export const VIEW_OF = { why: 'conops', today: 'conops', alerts: 'conops', stations: 'conops', what: 'conops', hear: 'coverage', sound: 'coverage' };
// → from an explainer continues the chain from the speakers step.
export const storyIndex = step => (STORY.includes(step) ? STORY.indexOf(step) : STORY.indexOf('alerts'));
// Link names: #design/network for the S-3 network step (its id stays 'what' for older #conops/what links).
export const hashOf = step => (step === 'what' ? 'network' : step);
export const stepOfHash = sub => (sub === 'network' || sub === 'what' ? 'what' : TAB_OF[sub] ? sub : null);
export const TITLE = {
  why: 'Research: why the basin needs S-3', today: 'Research: today, without S-3',
  alerts: 'Design: where the alerts are heard, speakers and receivers', stations: 'Design: the ranger stations that look after the speakers',
  what: 'Design: the S-3 network', hear: 'Design: who must hear the alert', sound: 'Design: how far a voice carries',
};

// The step buttons for the current step's tab (clicks are handled by src/main.js through data-co-step).
export function stepBar(step) {
  const tab = TAB_OF[step], btn = ([s, label]) => `<button data-co-step="${s}" aria-pressed="${s === step}">${label}</button>`;
  const next = tab === 'research' ? `<button data-co-step="alerts" aria-pressed="false">Design →</button>` : '';
  const detail = DETAIL[step] ? `<button data-co-step="${step}" aria-pressed="true">${DETAIL[step]}</button>` : '';
  return `<div class="seg co-step" role="group" aria-label="${tab === 'research' ? 'Research' : 'Design'} step (← →)">${STEPS[tab].map(btn).join('')}${detail}${next}</div>`;
}
