// The basin map, five steps of one story across the Research and Design tabs. "Why" shows what S-3 is up against
// (people, conflict, fire, floods, protected areas, existing infrastructure); "Today" what the basin has without S-3;
// "Speakers & receivers" where the alerts are heard, placed where people and hazards meet; "Ranger stations" the
// stations derived from those speakers; "S-3 network" the stations wired to satellites and hubs, with sliders and
// toggles that drive the requirement checks, the cost range and the coverage curve (model.js).
import { D, YEARS, MODES, geo as loadGeo, grid as loadGrid, pop as loadPop, stations as loadStations, hazards as loadHz, today as loadToday, coverage as loadCov, firstCovered } from '../v2/data.js';
import { el, seg, tag, fmt, fmtM, sv, svText, chartBlock, showTip, hideTip, kv } from '../v2/ui.js';
import { evaluate, sweetSpot, LEO_SIZES, ASSUME, TODAY, todayReach, compareToday } from './model.js';
import { createConopsMap, FAMILY, familyOf } from './map.js';
import { GAP } from '../content.js';
import { stepBar } from '../steps.js';
import { evaluateKit, DEFAULT_KIT, KIT } from '../coverage/stationkit.js';
import '../v2/v2.css';
import './conops.css';

const BEST = k => (k === 1 ? [D.db.recommended[0]] : D.db.best_by_count[String(k)].nodes);
const DESIGN = () => ({
  year: 2041, mode: 'alerts', n: null, repeaters: 0, nodes: BEST(4), leoSats: 24, geo: true, starlink: true, hydro: false, raised: true, fail: null,
  sensors: Object.fromEntries(D.sn.types.map(t => [t.id, t.baseline_count])),
});
export const S = {
  step: 'why', ...DESIGN(), resTab: 'overview', sweep: 'leoSats',
  today: { reached: true, unreached: true, rings: true, infra: true },
  alerts: { hazard: true, receivers: true, urban: true, speakers: true },
  stationsShow: { links: true, srr: true },
  kit: DEFAULT_KIT(), kitPlan: null,
  why: { pop: true, infra: true, conflict: true, fire: true, flood: true, pa: true },
  show: { coverage: true, reach: true, geo: true, water: true, forest: true, fire: true, flowUp: false, flowAlert: true, flowTwo: true, hud: true },
};

const CHECK_NAMES = {
  'S3-01': 'Coverage', 'S3-02': 'Capacity', 'S3-03': '≤30 min', 'S3-04': 'Terminal', 'S3-05': 'Alert ≤10 min',
  'S3-06': 'Targeting', 'S3-07': '≤$25', 'S3-08': 'Responders', 'S3-09': '≤6 h', 'S3-10': '≥99.5%', LCC: '≤$400M',
};
const CHECK_FULL = {
  'S3-01': 'Service area', 'S3-02': 'Sensor terminals and data', 'S3-03': 'Priority sensor message to the COP', 'S3-04': 'Terminal life and cost',
  'S3-05': 'Authorized alert to audible', 'S3-06': 'Geo-targeting and languages', 'S3-07': 'Community receiver', 'S3-08': 'Responder two-way terminals',
  'S3-09': 'Command or acknowledgment delivered', 'S3-10': 'Availability in rain, service life', LCC: 'Life-cycle cost, 15 years',
};
const FAILS = [[null, 'None'], ['hub', 'Hub down'], ['leo', 'LEO plane lost'], ['geo', 'GEO lost'], ['grid', 'Grid and cell down'], ['station', 'Station flooded']];
const LINE_COL = { leo: '--s1', geo: '--s7', stations: '--s4', repeaters: '--data', antennas: '--s3', db: '--accent', receivers: '--s5', backhaul: '--s2' };

let root = null, map = null, hud = null, hudToday = null, hudAlerts = null, hudStations = null, hudKit = null, baseKit = null, G = null, R = null, base = null, spot = null, nodeStats = null, raf = 0, timer = 0;
const $ = s => root.querySelector(s);

// ---------- data for the current year ----------
async function loadYear() {
  const [geo, grid, pop, st, hz, today, cov] = await Promise.all([loadGeo(), loadGrid(), loadPop(S.year), loadStations(S.year), loadHz(), loadToday(), loadCov()]);
  if (!(G && G.grid === grid)) {
    const cellLL = grid.i.map(i => [grid.lon0 + (i % grid.nx) * grid.res_deg, grid.lat0 + Math.floor(i / grid.nx) * grid.res_deg]);
    G = { geo, grid, first: firstCovered, cellLL, cellIdx: new Map(grid.i.map((g, k) => [g, k])), today, todayReach: todayReach(grid, cellLL, today.towns), cov: prepCov(cov) };
  }
  G = { ...G, pop, st, hz };
  G.cov.srr = st.runs.mix.stations.slice(0, sweetSpot(st.runs.mix).knee); // the SRR stations, for comparison
  G.todayNow = G.todayReach.share(pop); // today's reach for this year's population
  spot = sweetSpot(st.runs[S.mode]);
  S.kitPlan = evaluateKit(S.kit, G.cov);
  baseKit = evaluateKit(DEFAULT_KIT(), G.cov);
  if (S.n == null) S.n = S.mode === 'alerts' ? S.kitPlan.nMain : spot.knee;
  const b = DESIGN();
  base = evaluate(D, st, { ...b, n: b.mode === 'alerts' ? baseKit.nMain : spot.knee, year: S.year, dbNodes: BEST(4), ...kitCost(baseKit, baseKit.nMain) });
}
const opts = () => ({ ...S, dbNodes: S.nodes, ...(S.mode === 'alerts' && S.kitPlan ? kitCost(S.kitPlan, S.n) : {}) });
// In the Speakers mode the station line is the station design: each main station at its access type's 15-year cost,
// plus the waypoint posts (Design tab, "What's at a station").
function kitCost(P, n) {
  return {
    stationCost: list => (list.slice(0, n).reduce((a, s) => a + P.byType[s.type].total15, 0) + P.postsTotal) / 1e6,
    stationLabel: `Ranger stations (${n}) + waypoint posts (${P.nPosts})`,
  };
}

// Speakers and the stations derived from them (coverage.json): rollout order (people heard x (1 + hazard), so the
// crowded, high-hazard places come first), each cell's station, and which cells are urban centres.
function prepCov(cov) {
  const C = cov.cells, order = [];
  for (let k = 0; k < C.t1.length; k++) if (C.t1[k] > 0) order.push(k);
  order.sort((a, b) => (C.heard[b] / C.t1[b]) * (1 + C.hazard[b]) - (C.heard[a] / C.t1[a]) * (1 + C.hazard[a]));
  const b = atob(cov.stations.owner_b64), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  const urbanCells = new Set(); C.urban.forEach((v, k) => v && urbanCells.add(k));
  return { ...cov, order, owner: new Uint16Array(u.buffer), urbanCells };
}

// Average distance from a resident to the nearest database node, and the share within 500 km (population-weighted).
function nodeDistances() {
  const nodes = S.nodes.map(n => D.db.candidates.find(c => c.name === n)).filter(Boolean);
  let sum = 0, w = 0, near = 0;
  for (let k = 0; k < G.grid.i.length; k++) {
    const [lon, lat] = G.cellLL[k], p = G.pop[k];
    let best = 1e9;
    for (const nd of nodes) {
      const dLat = ((nd.lat - lat) * Math.PI) / 180, dLon = ((nd.lon - lon) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((nd.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      best = Math.min(best, 2 * 6371 * Math.asin(Math.sqrt(a)));
    }
    sum += best * p; w += p; if (best <= 500) near += p;
  }
  return { meanKm: sum / w, within500: (100 * near) / w };
}

// ---------- layout ----------
export async function mount(el_, step = 'why') {
  root = el_;
  S.step = step;
  root.innerHTML = `
    <div class="co" data-step="${S.step}">
      <header class="co-head">
        <div><div class="pv-eyebrow"><span class="co-e-research">Research · where things happen and what exists</span><span class="co-e-design">Design · RFP S-3</span></div>
          <h2 class="co-title"><span class="co-t-why">Why the basin needs S-3</span><span class="co-t-today">Today, without S-3</span><span class="co-t-alerts">Where the alerts are heard</span><span class="co-t-stations">Who looks after the speakers</span><span class="co-t-kit">What's at a ranger station</span><span class="co-t-what">The S-3 network</span></h2></div>
        <div class="co-stepbar">${stepBar(S.step)}</div>
      </header>
      <div class="co-body">
        <div class="co-mapcol"><div class="co-map"><div class="v2-loading">Loading the basin…</div></div><div class="co-legend"></div></div>
        <div class="co-col co-side"><div class="co-pane is-why"></div><div class="co-pane is-today"></div><div class="co-pane is-alerts"></div><div class="co-pane is-stations"></div><div class="co-pane is-kit"></div><div class="co-pane is-what"></div></div>
        <div class="co-col co-res"><div class="co-pane is-why"></div><div class="co-pane is-today"></div><div class="co-pane is-alerts"></div><div class="co-pane is-stations"></div><div class="co-pane is-kit"></div><div class="co-pane is-what"></div></div>
      </div>
    </div>`;
  await loadYear();
  map = createConopsMap($('.co-map'), { onNode: toggleNode });
  hud = el('div', { class: 'co-hud', role: 'status', 'aria-label': 'Design numbers' });
  hudToday = el('div', { class: 'co-hud co-hud-today', role: 'status', 'aria-label': 'What the basin has today' });
  hudAlerts = el('div', { class: 'co-hud co-hud-alerts', role: 'status', 'aria-label': 'Speakers and receivers' });
  hudStations = el('div', { class: 'co-hud co-hud-stations', role: 'status', 'aria-label': 'Ranger stations derived from the speakers' });
  hudKit = el('div', { class: 'co-hud co-hud-kit', role: 'status', 'aria-label': 'The station design' });
  map.wrap.append(hudToday, hudAlerts, hudStations, hudKit, hud);
  nodeStats = nodeDistances();
  R = evaluate(D, G.st, opts());
  map.draw(G, S, R);
  buildWhy();
  buildToday();
  buildAlerts();
  buildStations();
  buildKit();
  buildWhat();
  renderLegend();
  renderResults();
  renderHud();
  renderToday();
  if (['alerts', 'stations'].includes(S.step)) map.play(S.step);
}

export function setStep(step) {
  if (!root || !['why', 'today', 'alerts', 'stations', 'kit', 'what'].includes(step)) return;
  const was = S.step;
  S.step = step;
  if (step !== was && ['alerts', 'stations', 'kit', 'what'].includes(step)) map?.play(step);
  $('.co').dataset.step = step;
  $('.co-stepbar').innerHTML = stepBar(step);
  renderLegend();
  map?.describe(R);
  map?.sync(S);
  hideTip();
}
export const getStep = () => S.step;
export function refit() { if (map && G) map.draw(G, S, R); }

// ---------- recompute after a change (at most once per frame) ----------
// Next animation frame, or a short timer when the page gets no frames (a background tab) so changes still apply.
function nextFrame(fn) {
  let done = false;
  const run = () => { if (!done) { done = true; cancelAnimationFrame(raf); clearTimeout(timer); fn(); } };
  cancelAnimationFrame(raf); clearTimeout(timer);
  raf = requestAnimationFrame(run); timer = setTimeout(run, 80);
}
function update({ data = false } = {}) {
  nextFrame(async () => {
    if (data) { await loadYear(); nodeStats = nodeDistances(); }
    R = evaluate(D, G.st, opts());
    if (data) map.draw(G, S, R); else map.drawWhat(S, R);
    renderResults();
    renderHud();
    renderToday();
    syncControls();
  });
}

function toggleNode(name) {
  if (name === S.nodes[0]) return;
  if (S.nodes.includes(name)) S.nodes = S.nodes.filter(n => n !== name);
  else if (S.nodes.length < 4) S.nodes = [...S.nodes, name];
  else return;
  nodeStats = nodeDistances();
  update();
}

// ---------- why: layer switches and the facts behind them ----------
function buildWhy() {
  const hz = G.hz, pa = G.geo.pa.areas, paKm2 = pa.reduce((a, x) => a + (x.area_km2_in_basin || 0), 0);
  const layers = [
    ['pop', 'People per km²', 'linear-gradient(90deg, var(--seq-1), var(--seq-6))', 'WorldPop'],
    ['conflict', `Violent events 2015–24 · ${fmt(hz.conflict.events)}`, 'var(--critical)', 'UCDP'],
    ['fire', `Fire detections 2024 · ${fmt(hz.fires.detections)}`, 'var(--s2)', 'NASA FIRMS'],
    ['flood', `Flood alerts since 2000 · ${hz.floods.events.length}`, 'var(--river)', 'GDACS'],
    ['pa', `Protected areas · ${pa.length}`, 'var(--s6)', 'WDPA'],
    ['infra', 'Data centres, cables, hydro, roads', 'var(--text)', 'see Sources'],
  ];
  const side = $('.co-side .is-why');
  side.replaceChildren(
    el('h3', { class: 'co-h', text: 'On the map' }),
    el('div', { class: 'co-layers' }, layers.map(([k, label, sw, src]) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = S.why[k];
      cb.addEventListener('change', () => { S.why[k] = cb.checked; map.drawWhy(S); });
      return el('label', { class: 'co-layer' }, cb, el('i', { style: `background:${sw}` }), el('span', { text: label }), el('small', { text: src }));
    })),
    el('p', { class: 'co-hint' }, 'Press ', el('kbd', { text: '→' }), ' for what the basin has today.'),
  );
  const people = y => G.grid.summary[String(y)].basin_total;
  const byYear = Object.entries(hz.conflict.by_year);
  const maxY = Math.max(...byYear.map(([, v]) => v));
  const bars = sv('svg', { viewBox: '0 0 300 86', class: 'vsvg', role: 'img', 'aria-label': 'Violent events in the basin by year, 2015 to 2024' });
  byYear.forEach(([y, v], i) => {
    const h = (v / maxY) * 50, x = 6 + i * 29;
    sv('rect', { x, y: 66 - h, width: 22, height: h, rx: 2, fill: 'var(--critical)', opacity: 0.75 }, bars);
    svText(bars, { x: x + 11, y: 80, 'text-anchor': 'middle', class: 'axl' }, `'${y.slice(2)}`);
    svText(bars, { x: x + 11, y: 62 - h, 'text-anchor': 'middle', class: 'sub' }, fmt(v));
  });
  const fact = (v, l, src) => el('div', { class: 'co-fact' }, el('b', { text: v }), el('span', { text: l }), src ? el('small', { text: src }) : null);
  $('.co-res .is-why').replaceChildren(
    el('div', { class: 'co-facts' },
      fact(`${fmt(people(2026) / 1e6, 0)}M → ${fmt(people(2041) / 1e6, 0)}M`, 'people in the basin, 2026 → 2041', 'WorldPop, UN growth'),
      fact(fmt(hz.conflict.deaths_best), `deaths in ${fmt(hz.conflict.events)} violent events, 2015–24`, 'UCDP GED'),
      fact(fmt(hz.fires.detections), 'fire detections in 2024 (DR Congo)', 'NASA FIRMS'),
      fact(String(hz.floods.events.length), 'flood alerts since 2000', 'GDACS'),
      fact(`${fmt((100 * paKm2) / 3.7e6, 1)}%`, `of the basin is protected (${pa.length} areas)`, 'WDPA'),
    ),
    chartBlock('co-conflict', 'Violent events by year', bars, [['Year', 'Events'], ...byYear.map(([y, v]) => [y, fmt(v)])]),
    el('div', { class: 'co-gap' }, el('h3', { class: 'co-h', text: 'The gap' }),
      el('ul', {}, [GAP.out.facts[0], GAP.out.facts[1], GAP.in.facts[0], GAP.in.facts[2]].map(f => el('li', { text: f })))),
  );
}

// ---------- what: the design controls ----------
let ctl = {};
function buildWhat() {
  const group = (title, ...kids) => el('div', { class: 'co-group' }, el('h3', { class: 'co-h', text: title }), ...kids);
  const range = (label, min, max, step, get, set, fmtOut = v => fmt(v)) => {
    const out = el('b', { class: 'ctl-out' }), inp = el('input', { type: 'range', min, max, step, 'aria-label': label });
    inp.value = get(); out.textContent = fmtOut(get());
    inp.addEventListener('input', () => { set(+inp.value); out.textContent = fmtOut(+inp.value); update(); });
    return { node: el('label', { class: 'ctl co-range' }, el('span', { text: label }), inp, out), inp, out, sync: () => { inp.value = get(); out.textContent = fmtOut(get()); } };
  };
  const toggle = (label, key, note) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = S[key];
    cb.addEventListener('change', () => { S[key] = cb.checked; update(); });
    return el('label', { class: 'co-opt' }, cb, el('span', { text: label }), note ? el('small', { text: note }) : null);
  };

  ctl.year = el('div', { class: 'co-slot' });
  ctl.mode = el('div', { class: 'co-slot' });
  ctl.stations = range('Ranger stations', 0, G.st.runs[S.mode].stations.length, 1, () => S.n, v => { S.n = v; });
  ctl.spot = el('div', { class: 'co-spot' });
  ctl.curve = el('div', { class: 'co-curve' });
  ctl.repeaters = range('Canopy repeaters', 0, 300, 5, () => S.repeaters, v => { S.repeaters = v; });
  ctl.nodes = el('div', { class: 'co-slot' });
  ctl.nodeNote = el('p', { class: 'co-note' });
  ctl.leo = el('div', { class: 'co-slot' });
  ctl.fail = el('div', { class: 'co-slot' });
  ctl.sensors = D.sn.types.map(t => range(t.name.split(' (')[0], 0, t.baseline_count * 3, Math.max(10, Math.round(t.baseline_count / 20)),
    () => S.sensors[t.id], v => { S.sensors[t.id] = v; }));
  ctl.sensorSum = el('span', { class: 'co-sum' });

  $('.co-side .is-what').replaceChildren(
    group('Year', ctl.year),
    group('Ranger stations', ctl.stations.node, ctl.spot, ctl.curve, ctl.mode),
    group('Under the canopy', ctl.repeaters.node, toggle('Raised antennas on fixed sensors', 'raised', '≈$40 each')),
    group('Database nodes', ctl.nodes, ctl.nodeNote),
    group('Space and backhaul', ctl.leo, toggle('GEO broadcast payload', 'geo'), toggle('Starlink at stations and nodes', 'starlink'), toggle('Micro-hydro at river stations', 'hydro')),
    el('details', { class: 'co-group co-sensors' }, el('summary', {}, el('span', { class: 'co-h', text: 'Sensors' }), ctl.sensorSum), ...ctl.sensors.map(s => s.node)),
    group('Failure case', ctl.fail),
    el('button', { class: 'v2-link co-reset', onclick: resetDesign, text: 'Reset to the baseline design' }),
    el('p', { class: 'co-foot' }, tag('Assumptions'), ' radii, canopy shares, capacity and costs · ', tag('Proposed allocation, TBR'), ' latency split · method: ',
      el('a', { class: 'v2-link', href: 'https://github.com/corrigk/congo-river-basin-SRR/blob/main/docs/conops-model.md', target: '_blank', rel: 'noopener', text: 'ConOps model note' })),
  );
  syncControls();
}

// Segmented controls are rebuilt on change (a click, never mid-drag); sliders only update their value.
function syncControls() {
  ctl.year.replaceChildren(seg(YEARS.map(y => [y, String(y)]), S.year, v => { S.year = v; S.n = null; update({ data: true }); }, 'Year'));
  ctl.mode.replaceChildren(el('span', { class: 'co-sub', text: 'Reach counted by' }),
    seg(Object.entries(MODES).map(([k, m]) => [k, m.short]), S.mode, v => { S.mode = v; S.n = null; update({ data: true }); }, 'Coverage mode'));
  ctl.nodes.replaceChildren(seg([1, 2, 3, 4].map(k => [k, String(k)]), S.nodes.length, k => { S.nodes = BEST(k); nodeStats = nodeDistances(); update(); }, 'Number of database nodes'));
  ctl.nodeNote.textContent = `${S.nodes.join(', ')}. Average ${fmt(nodeStats.meanKm)} km to a node; ${fmt(nodeStats.within500)}% of people within 500 km. Click a city on the map to move one.`;
  ctl.leo.replaceChildren(el('span', { class: 'co-sub', text: 'LEO satellites' }), seg(LEO_SIZES.map(n => [n, String(n)]), S.leoSats, v => { S.leoSats = v; update(); }, 'LEO satellites'));
  ctl.fail.replaceChildren(seg(FAILS, S.fail, v => { S.fail = v; update(); }, 'Failure case'));
  ctl.stations.inp.max = G.st.runs[S.mode].stations.length;
  ctl.stations.sync(); ctl.repeaters.sync(); ctl.sensors.forEach(s => s.sync());
  ctl.sensorSum.textContent = `${fmt(R.terminals)} terminals`;
  ctl.curve.replaceChildren(curveChart());
  // Sweet-spot band painted under the station slider.
  const pct = v => `${(v / G.st.runs[S.mode].stations.length) * 100}%`;
  ctl.spot.replaceChildren(
    el('div', { class: 'co-band', 'aria-hidden': 'true' }, el('i', { style: `left:${pct(spot.lo)};width:calc(${pct(spot.hi)} - ${pct(spot.lo)})` }), el('b', { style: `left:${pct(spot.knee)}` })),
    el('p', { class: 'co-note' }, `Sweet spot ${spot.knee} · range ${spot.lo}–${spot.hi} · `, el('button', { class: 'v2-link', text: 'use it', onclick: () => { S.n = spot.knee; update(); } })),
  );
}

function resetDesign() {
  const keepYear = S.year;
  Object.assign(S, DESIGN(), { year: keepYear, n: null });
  update({ data: true });
}

// ---------- speakers & receivers: where the alerts are heard ----------
const cell = (big, label, over) => el('div', { class: `co-hud-c${over ? ' is-over' : ''}` }, el('b', { text: big }), el('span', { text: label }));
const k = v => (v >= 1e6 ? `${fmt(v / 1e6, 1)}M` : v >= 1e4 ? `${fmt(v / 1e3)}k` : fmt(v));
function buildAlerts() {
  const cv = G.cov, y = cv.by_year[cv.year], b = cv.bands;
  const L = S.alerts, layers = [['speakers', 'Village speakers (T1)', 'var(--gold)'], ['receivers', 'Community receivers (T2)', 'var(--river)'], ['urban', 'Urban centres: phones and radio (T3)', 'transparent'], ['hazard', 'Hazard score (from the Why map)', 'var(--rust-hi)']];
  $('.co-side .is-alerts').replaceChildren(
    el('h3', { class: 'co-h', text: 'On the map' }),
    el('div', { class: 'co-layers' }, layers.map(([key, label, sw]) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = L[key];
      cb.addEventListener('change', () => { L[key] = cb.checked; map.drawAlerts(S); });
      return el('label', { class: 'co-layer' }, cb, el('i', { style: `background:${sw};${key === 'urban' ? 'border:1.5px solid var(--s2)' : ''}` }), el('span', { text: label }), el('small', { text: key === 'hazard' ? 'Why map' : 'GRID3 / proxy' }));
    })),
    el('h3', { class: 'co-h', text: 'How they are placed' }),
    el('p', { class: 'co-note' }, `Speakers go on real settlements: each one covers the settlement blocks within its voice (about ${cv.radius_m.base} m at night out of a village into forest), placed where they reach the most people still uncovered, down to ${cv.cutoff_people.base} people. Big built-up blocks get several. Hamlets left over get a $25 receiver each; urban centres rely on phones and radio first.`),
    el('p', { class: 'co-note' }, el('b', { text: 'Informed by the Why map: ' }), `speakers roll out first where people and hazards meet (people heard × (1 + hazard score: conflict, fire and floods, equal weights)). The first tenth of the rollout sits at ${fmt((cv.rollout.first_tenth_mean_hazard / cv.rollout.all_mean_hazard) * 100 - 100)}% higher hazard than the average speaker.`),
    el('div', { class: 'co-explain' },
      el('button', { class: 'v2-link', 'data-co-step': 'hear', text: 'Who must hear it? →' }),
      el('button', { class: 'v2-link', 'data-co-step': 'sound', text: 'How far a voice carries →' })),
    el('p', { class: 'co-note' }, tag('Sourced', 'baseline'), ' DRC (76% of the basin\'s people): GRID3 Settlement Extents v4.0, 1.07M blocks, people per block from WorldPop by building count. ', tag('Modeled proxy', 'proxy'), ' Elsewhere: people spread evenly in each 1 km WorldPop cell until those countries\' settlement data is added.'),
    el('p', { class: 'co-hint' }, 'Press ', el('kbd', { text: '→' }), ' for the ranger stations these speakers need.'),
  );
  hudAlerts.replaceChildren(
    cell(k(y.t1), 'village speakers'), cell(`${fmt(y.t1_heard_pct)}%`, 'of rural + peri-urban people within a speaker\'s voice'),
    cell(k(y.t2), 'community receivers'), cell(k(y.t1 + y.t2), 'S3-05 receivers in all'), cell(k(y.urban_pop), 'people in urban centres: phones first'));
  const W = 320, H = 150, m = { l: 34, r: 10, t: 10, b: 24 }, c = cv.curve, xMax = c.n[c.n.length - 1], yMax = 100;
  const X = v => m.l + (Math.log10(Math.max(v, 100)) - 2) / (Math.log10(xMax) - 2) * (W - m.l - m.r), Y = v => H - m.b - (v / yMax) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg', role: 'img', 'aria-label': 'People who can hear a village speaker against the number of speakers, in rollout order' });
  for (const v of [0, 50, 95]) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 95 ? 'sd-cap' : 'gl' }, s); svText(s, { x: m.l - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'axl' }, `${v}%`); }
  svText(s, { x: W - m.r, y: Y(95) - 4, 'text-anchor': 'end', class: 'sub' }, '95% reference');
  for (const v of [100, 1000, 10000, 100000].filter(v => v <= xMax)) svText(s, { x: X(v), y: H - 8, 'text-anchor': 'middle', class: 'axl' }, k(v));
  sv('path', { d: `M${c.n.map((n, i) => `${X(n).toFixed(1)},${Y(c.pct[i]).toFixed(1)}`).join('L')}`, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 2.5 }, s);
  $('.co-res .is-alerts').replaceChildren(
    el('div', { class: 'co-headline' }, el('b', { text: `${k(y.t1)} speakers` }),
      el('span', { text: `reach ${fmt(y.t1_heard / 1e6, 1)}M people (${fmt(y.t1_heard_pct)}% of the rural and peri-urban ${fmt(y.design_pop / 1e6, 1)}M); ${k(y.t2)} receivers cover ${fmt(y.t2_pop / 1e6, 1)}M more in smaller villages. Range ${k(b.high.t1)}–${k(b.low.t1)} speakers across the acoustic assumptions.` })),
    chartBlock('co-spk-curve', 'People within a speaker\'s voice, in rollout order', s, [['Speakers', '% of rural + peri-urban people'], ...c.n.filter((_, i) => i % 4 === 0).map((n, i) => [fmt(n), `${fmt(c.pct[i * 4], 1)}%`])]),
    chartBlock('co-spk-bands', 'Speakers needed across the range', el('table', { class: 'vtable' },
      el('thead', {}, el('tr', {}, ['Case', 'Voice reaches', 'Smallest group', 'Speakers', 'People within'].map(h => el('th', { text: h })))),
      el('tbody', {}, ['high', 'base', 'low'].map(n => el('tr', {}, el('th', { scope: 'row', text: n === 'high' ? 'Far (loud, little forest loss)' : n === 'low' ? 'Near (quiet, dense forest)' : 'Base' }),
        el('td', { text: `${b[n].radius_m} m` }), el('td', { text: `${b[n].cutoff} people` }), el('td', { text: k(b[n].t1) }), el('td', { text: `${fmt(b[n].t1_heard_pct)}%` }))))),
    [['Case', 'Radius m', 'Cutoff', 'Speakers', 'Heard %'], ...['high', 'base', 'low'].map(n => [n, String(b[n].radius_m), String(b[n].cutoff), String(b[n].t1), String(b[n].t1_heard_pct)])]),
    el('p', { class: 'co-note' }, 'S3-05 counts receivers: every village speaker carries the same GEO receiver as the $25 community receiver, so both count. The people share is information, with 95% as a reference line.'),
  );
}

// ---------- ranger stations: derived from the speakers ----------
function buildStations() {
  const st = G.cov.stations, f = st.x_formula;
  const calc = { crews: f.crews_per_station, hours: f.crew_hours_yr, visits: f.visits_per_speaker_yr, perVisit: f.hours_per_visit, t: String(st.T_maint_h) };
  const side = $('.co-side .is-stations'), res = $('.co-res .is-stations');
  const L = S.stationsShow;
  const tog = (key, label, sw) => { const cb = el('input', { type: 'checkbox' }); cb.checked = L[key]; cb.addEventListener('change', () => { L[key] = cb.checked; map.drawStations(S); }); return el('label', { class: 'co-layer' }, cb, el('i', { style: sw }), el('span', { text: label })); };
  const out = el('div');
  const draw = () => {
    const X = Math.floor((calc.crews * calc.hours) / (calc.visits * calc.perVisit));
    const rows = st.sweep[calc.t];
    // stations needed at this X: interpolate the precomputed X x T_maint table on log X
    let n = rows[0].stations;
    for (let i = 1; i < rows.length; i++) if (X <= rows[i].X) { const a = rows[i - 1], b = rows[i], t = (Math.log(X) - Math.log(a.X)) / (Math.log(b.X) - Math.log(a.X)); n = Math.round(a.stations + t * (b.stations - a.stations)); break; } else n = rows[i].stations;
    out.replaceChildren(
      el('div', { class: 'co-headline' }, el('b', { text: `X = ${fmt(X)} → ${fmt(n)} stations` }),
        el('span', { text: `each looking after up to ${fmt(X)} speakers within ${calc.t} h (${fmt(rows[rows.length - 1].unassigned)} speakers have no possible site that close)` })),
      stationCurve(X, calc.t));
  };
  const tSel = el('div', { class: 'co-slot' });
  const pickT = v => { calc.t = v; tSel.replaceChildren(seg([['4', '4 h'], ['8', '8 h'], ['24', '24 h']], calc.t, w => { pickT(w); draw(); }, 'Longest trip')); };
  pickT(calc.t);
  const slider = (label, key, min, max, step, unit) => {
    const o = el('b', { text: `${calc[key]} ${unit}` });
    return el('div', { class: 'co-calc' }, el('span', { text: label }), o, el('input', { type: 'range', min, max, step, value: calc[key], 'aria-label': label, oninput: e => { calc[key] = +e.target.value; o.textContent = `${calc[key]} ${unit}`; draw(); } }));
  };
  side.replaceChildren(
    el('h3', { class: 'co-h', text: 'On the map' }),
    el('div', { class: 'co-layers' }, tog('links', 'Each speaker area wired to its station', 'background:var(--text);height:2px'), tog('srr', `The SRR's ${st.compare.srr_sweet_spot} stations (outline)`, 'border:1.5px solid var(--muted)')),
    el('h3', { class: 'co-h', text: 'How the stations are derived' }),
    el('p', { class: 'co-note' }, `Rangers keep the village speakers (team decision). A station's crews can look after up to X speakers within an ${st.T_maint_h}-hour trip by boat, road or foot (the SRR travel model). Stations open where they can take the most unassigned speakers, until every reachable speaker has one.`),
    el('h3', { class: 'co-h', text: 'Crew-hours calculator' }),
    el('p', { class: 'co-note', text: 'X = crews × hours a year ÷ (visits a year × hours a visit)' }),
    slider('Crews per station', 'crews', 1, 4, 1, ''), slider('Hours per crew a year', 'hours', 1000, 2200, 100, 'h'),
    slider('Visits per speaker a year', 'visits', 1, 6, 1, ''), slider('Hours a visit, travel included', 'perVisit', 2, 16, 1, 'h'),
    el('div', { class: 'co-calc' }, el('span', { text: 'Longest trip' }), tSel),
    el('p', { class: 'co-note' }, tag('Assumption', 'assume'), ' Crew numbers and visit hours are TBR. The map shows X = ', el('b', { text: String(st.X) }), ` and ${st.T_maint_h} h.`),
    el('p', { class: 'co-hint' }, 'Press ', el('kbd', { text: '→' }), ' to design what is at a station: most of these sites do not need a full one.'),
  );
  const run = G.st.runs.alerts.stations, last = run[run.length - 1];
  hudStations.replaceChildren(
    cell(fmt(st.list.length), `stations (${fmt(st.sites)} sites)`), cell(fmt(st.X), `speakers each, at most · ${st.T_maint_h} h trips`),
    cell(fmt(st.compare.srr_sweet_spot), 'SRR stations, for comparison'), cell(k(st.unassigned), 'speakers beyond 8 h', st.unassigned > 0),
    cell(`$${fmt(last.cum_cost_musd)}M`, 'stations, 15 years', last.cum_cost_musd > 400));
  res.replaceChildren(out,
    el('div', { class: 'co-chain' }, el('b', { text: 'Speakers' }), el('i', { text: '→' }), el('b', { text: `${fmt(st.list.length)} stations` }), el('i', { text: '→' }), el('span', { text: `S-3 network: these stations are the "Speakers" mode of the station slider there, so their cost and coverage flow into the requirement checks.` })),
    el('p', { class: 'co-note' }, `These ${fmt(st.list.length)} stations cost $${fmt(last.cum_cost_musd)}M over 15 years on their own, more than the whole $400M cap, and reach ${fmt(last.cum_pct, 1)}% of people by radio or a 1-hour response. Fewer speakers (settlement outlines in Stage 3), more speakers per crew, or communities keeping the smaller speakers bring it down: the curve shows how fast.`));
  draw();
}
// ---------- what's at a station: the station design, its crews and its cost ----------
function buildKit() {
  const side = $('.co-side .is-kit'), K = S.kit;
  const change = () => {
    S.kitPlan = evaluateKit(K, G.cov);
    if (S.mode === 'alerts') S.n = S.kitPlan.nMain;
    renderKit(); map.drawStations(S); update();
  };
  const pick = (part, label) => {
    const sel = el('select', { 'aria-label': label, onchange: e => { K[part] = e.target.value; change(); } },
      KIT.main[part].options.map(o => el('option', { value: o.id, text: `${o.name} · $${fmt(o.usd / 1000, o.usd < 10000 ? 1 : 0)}k`, selected: o.id === K[part] || null })));
    return el('label', { class: 'co-kit-row' }, el('span', { text: label }), sel);
  };
  const slider = (label, key, min, max, step, unit, digits = 0) => {
    const o = el('b', { text: `${fmt(K[key], digits)} ${unit}` });
    return el('div', { class: 'co-calc' }, el('span', { text: label }), o,
      el('input', { type: 'range', min, max, step, value: K[key], 'aria-label': label, oninput: e => { K[key] = +e.target.value; o.textContent = `${fmt(K[key], digits)} ${unit}`; }, onchange: change }));
  };
  const posts = el('input', { type: 'checkbox' }); posts.checked = K.posts;
  posts.addEventListener('change', () => { K.posts = posts.checked; change(); });
  side.replaceChildren(
    el('div', { class: 'co-kit' },
      el('h3', { class: 'co-h', text: 'Main station' }),
      pick('building', 'Building'), pick('tower', 'Tower'), pick('speaker', 'Station loudspeaker'), pick('radio', 'Ranger radios'), pick('backhaul', 'Backhaul (upload / download)'),
      el('p', { class: 'co-note', text: `Always: S-3 responder terminal ($${fmt(KIT.main.terminal.usd)}), medical and spares kit ($${fmt(KIT.main.kit.usd)}), solar sized to the loads.` }),
      el('h3', { class: 'co-h', text: 'Crews' }),
      slider('Crews per station', 'crews', 1, 4, 1, ''), slider('People per crew', 'people', 2, 6, 1, ''), slider('Hours per crew a year', 'hoursYr', 1000, 2200, 100, 'h'),
      el('h3', { class: 'co-h', text: 'Visits' }),
      slider('Routine visits per speaker a year', 'routine', 0, 4, 0.5, '', 1), slider('Repair visits per speaker a year', 'repair', 0, 1, 0.05, '', 2),
      slider('Hours on site', 'onsite', 0.5, 4, 0.5, 'h', 1), slider('Speakers per round', 'perRound', 1, 20, 1, ''),
      el('label', { class: 'co-opt' }, posts, el('span', { text: 'Waypoint posts: crews run 24 h circuits, overnighting at posts' })),
      el('h3', { class: 'co-h', text: 'Running' }),
      slider('Share of trip time under motor', 'motorShare', 0, 1, 0.05, '', 2), slider('Fuel price', 'fuelUsdL', 1, 2.5, 0.1, '$/L', 1),
      el('button', { class: 'v2-link', onclick: () => { Object.assign(K, DEFAULT_KIT()); buildKit(); change(); }, text: 'Back to the default design' }),
      el('p', { class: 'co-note' }, tag('Assumption', 'assume'), ' Station parts from the SRR cost model; leaner options, crew numbers, visits and fuel are estimates to replace with quotes and ranger input. Salaries are shown, not counted (team rule).')));
  renderKit();
}
function renderKit() {
  const P = S.kitPlan, before = G.cov.stations, beforeCost = G.st.runs.alerts.stations.at(-1).cum_cost_musd;
  const M = v => `$${fmt(v / 1e6, v < 1e7 ? 1 : 0)}M`;
  hudKit.replaceChildren(
    cell(fmt(P.nMain), 'main stations'), cell(fmt(P.nPosts), 'waypoint posts'), cell(fmt(P.X), 'speakers per station (X)'),
    cell(`$${fmt(P.avg15 / 1000)}k`, 'per main station, 15 yr'), cell(M(P.total), `stations + posts · was $${fmt(beforeCost)}M`, P.total / 1e6 > 400));
  const spec = el('div', { class: 'co-spec' }, [
    [`${fmt(P.spec.downMbps)} / ${fmt(P.spec.upMbps, P.spec.upMbps < 1 ? 3 : 0)}`, 'Mbps down / up'], [`${fmt(P.spec.relayKm, 1)} km`, `sensor relay reach (${P.spec.towerM} m tower)`],
    [P.spec.speakerM ? `${fmt(P.spec.speakerM)} m` : 'none', 'station loudspeaker heard at night'], [`${fmt(P.power.pvKwp, 1)} kWp`, `solar · ${fmt(P.power.battKwh)} kWh battery`],
    [fmt(P.spec.crewPeople), `crew on site (${S.kit.crews} × ${S.kit.people})`], [`${fmt(P.tripsYr)}`, `rounds a year, ${fmt(P.trip, 1)} h each way`],
  ].map(([b, t]) => el('div', {}, el('b', { text: b }), el('span', { text: t }))));
  const parts = chartBlock('co-kit-parts', 'One main station: parts', el('table', { class: 'vtable' },
    el('tbody', {}, P.parts.map(([k, name, usd]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: name }), el('td', { text: `$${fmt(usd)}` }))),
      el('tr', {}, el('th', { scope: 'row', text: 'Total' }), el('td', { text: 'before vehicles and the site logistics multiplier' }), el('td', { text: `$${fmt(P.fixedCapex)}` })))),
  [['Part', 'Choice', 'USD'], ...P.parts.map(([k, n, u]) => [k, n, fmt(u)])]);
  const types = Object.entries(P.byType).filter(([t]) => P.types[t]);
  const life = chartBlock('co-kit-life', '15 years per main station, by access', el('table', { class: 'vtable' },
    el('thead', {}, el('tr', {}, ['Access', 'Stations', 'Build', 'Running / yr', 'of it fuel', 'Replacements', '15 yr'].map(h => el('th', { text: h })))),
    el('tbody', {}, types.map(([t, v]) => el('tr', {}, el('th', { scope: 'row', text: t }), el('td', { text: fmt(P.types[t]) }), el('td', { text: `$${fmt(v.capex / 1000)}k` }),
      el('td', { text: `$${fmt(v.opexYr / 1000, 1)}k` }), el('td', { text: `$${fmt(v.fuelYr / 1000, 1)}k` }), el('td', { text: `$${fmt(v.repl / 1000)}k` }), el('td', { text: `$${fmt(v.total15 / 1000)}k` }))))),
  [['Access', 'Stations', 'Build', 'Running/yr', 'Fuel/yr', 'Replacements', '15 yr'], ...types.map(([t, v]) => [t, String(P.types[t]), fmt(v.capex), fmt(v.opexYr), fmt(v.fuelYr), fmt(v.repl), fmt(v.total15)])]);
  const max = Math.max(beforeCost * 1e6, P.total + P.salaries15);
  const bar = (label, v, col) => el('div', {}, el('span', { text: label }), el('i', { style: `width:${(v / max) * 100}%;background:var(${col})` }), el('b', { text: M(v) }));
  const compare = chartBlock('co-kit-cmp', 'Against every site as a full station', el('div', { class: 'co-costbar' },
    bar(`${fmt(before.list.length)} full stations`, beforeCost * 1e6, '--critical'),
    bar(`${fmt(P.nMain)} main stations`, P.mainTotal, '--s4'), bar(`${fmt(P.nPosts)} waypoint posts`, P.postsTotal, '--s5'),
    bar('Crew salaries (not counted)', P.salaries15, '--neu-3')),
  [['Line', '$M'], [`${before.list.length} full stations (SRR kit)`, fmt(beforeCost, 1)], ['Main stations', fmt(P.mainTotal / 1e6, 1)], ['Waypoint posts', fmt(P.postsTotal / 1e6, 1)], ['Salaries, not counted', fmt(P.salaries15 / 1e6, 1)]]);
  $('.co-res .is-kit').replaceChildren(
    el('div', { class: 'co-headline' }, el('b', { text: `${M(P.total)} for ${fmt(P.nMain)} stations + ${fmt(P.nPosts)} posts` }),
      el('span', { text: `over 15 years, against $${fmt(beforeCost)}M with every site a full station. Each station's crews look after up to ${fmt(P.X)} speakers: ${fmt(P.visits, 2)} visits a speaker a year, ${fmt(P.perRound)} speakers a round, ${fmt(P.trip, 1)} h trips.` })),
    spec, compare, parts, life,
    el('p', { class: 'co-note' }, `The biggest levers: visits per speaker (health telemetry means crews go only on a fault), speakers per round, and posts that let crews run longer circuits. Next, S-3 network: these ${fmt(P.nMain)} main stations are its "Speakers" stations, and this cost is its station line.`),
    el('p', { class: 'co-hint' }, 'Press ', el('kbd', { text: '→' }), ' to wire these stations to the satellites and hubs.'));
}

function stationCurve(Xnow, tSel) {
  const sw = G.cov.stations.sweep, W = 320, H = 170, m = { l: 40, r: 10, t: 10, b: 26 };
  const xs = sw[tSel].map(r => r.X), yMax = Math.max(...Object.values(sw).flat().map(r => r.stations));
  const X = v => m.l + (Math.log(v) - Math.log(xs[0])) / (Math.log(xs[xs.length - 1]) - Math.log(xs[0])) * (W - m.l - m.r), Y = v => H - m.b - (v / yMax) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg', role: 'img', 'aria-label': 'Stations needed against speakers per station, for three longest trips' });
  for (const v of [0, yMax / 2, yMax]) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'gl' }, s); svText(s, { x: m.l - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'axl' }, fmt(v)); }
  for (const v of xs.filter((_, i) => i % 2 === 0)) svText(s, { x: X(v), y: H - 10, 'text-anchor': 'middle', class: 'axl' }, fmt(v));
  svText(s, { x: (m.l + W) / 2, y: H - 0, 'text-anchor': 'middle', class: 'sub' }, 'speakers per station (X, log scale)');
  const col = { 4: '--s2', 8: '--gold', 24: '--river' };
  for (const [t, rows] of Object.entries(sw)) {
    sv('path', { d: `M${rows.map(r => `${X(r.X).toFixed(1)},${Y(r.stations).toFixed(1)}`).join('L')}`, fill: 'none', stroke: `var(${col[t]})`, 'stroke-width': t === tSel ? 3 : 1.5, opacity: t === tSel ? 1 : 0.6 }, s);
    const lr = rows[rows.length - 1]; svText(s, { x: X(lr.X) - 2, y: Y(lr.stations) - 5, 'text-anchor': 'end', class: 'sub' }, `${t} h`);
  }
  if (Xnow >= xs[0] && Xnow <= xs[xs.length - 1]) sv('line', { x1: X(Xnow), x2: X(Xnow), y1: m.t, y2: H - m.b, class: 'cursor' }, s);
  sv('line', { x1: m.l, x2: W - m.r, y1: Y(G.cov.stations.compare.srr_sweet_spot), y2: Y(G.cov.stations.compare.srr_sweet_spot), class: 'sd-cap' }, s);
  svText(s, { x: W - m.r, y: Y(G.cov.stations.compare.srr_sweet_spot) - 4, 'text-anchor': 'end', class: 'sub' }, `SRR ${G.cov.stations.compare.srr_sweet_spot}`);
  return chartBlock('co-x-curve', 'Stations needed: speakers per station × longest trip', s,
    [['X', ...Object.keys(sw).map(t => `${t} h`)], ...xs.map((x, i) => [String(x), ...Object.values(sw).map(rows => fmt(rows[i].stations))])]);
}

// ---------- today: what the basin has without S-3, and by how much the design improves it ----------
function buildToday() {
  const T = G.todayNow, side = $('.co-side .is-today');
  const layers = [['reached', 'People reached today', 'var(--river)', 'proxy'], ['unreached', 'People with no network', 'var(--rust-hi)', 'proxy'], ['rings', "Each town's reach", 'transparent', 'proxy'], ['infra', 'Data centres, cables, hydro', 'var(--text)', 'see Sources']];
  side.replaceChildren(
    el('h3', { class: 'co-h', text: 'On the map' }),
    el('div', { class: 'co-layers' }, layers.map(([k, label, sw, src]) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = S.today[k];
      cb.addEventListener('change', () => { S.today[k] = cb.checked; map.drawToday(S); });
      return el('label', { class: 'co-layer' }, cb, el('i', { style: `background:${sw};${k === 'rings' ? 'border:1.5px solid var(--river);border-radius:50%' : ''}` }), el('span', { text: label }), el('small', { text: src }));
    })),
    el('p', { class: 'co-note' }, tag('Modeled proxy'), ` Existing networks are drawn around the ${G.today.towns.length} towns and cities we hold: 40 km for 1M+ people, 25 km for 250k+, 15 km for 50k+, 8 km for smaller. It is not measured coverage. It agrees with the RFP's figure that the internet reaches 27–32% of people. Real tower data (for example OpenCelliD) would replace it.`),
    el('p', { class: 'co-note' }, 'The "With S-3" numbers use the design you set on the next step.'),
    el('p', { class: 'co-hint' }, 'Press ', el('kbd', { text: '→' }), ' for where the alerts will be heard.'),
  );
}

function renderToday() {
  const T = G.todayNow, d = TODAY;
  hudToday.replaceChildren(
    ...[[`${fmt(T.peoplePct)}%`, 'of people reached by existing networks*'], [`${d.gaugesLive[0]}–${d.gaugesLive[1]}`, `river gauges reporting, of ${d.gaugesHistoric}+`],
      [`${d.syncDays[0]}–${d.syncDays[1]} days`, 'for field data to arrive'], [`${d.noWarningPct}%`, 'got no warning in a disaster'], ['once a day', 'flood bulletin, by email']]
      .map(([big, label]) => el('div', { class: 'co-hud-c is-over' }, el('b', { text: big }), el('span', { text: label }))));
  const pane = $('.co-res .is-today');
  const gain = ((100 - T.peoplePct) / 100) * T.total / 1e6;
  pane.replaceChildren(
    el('div', { class: 'co-headline' },
      el('b', { text: `${fmt(T.peoplePct)}% → ${R.geoUp ? '100' : fmt(T.peoplePct)}%` }),
      el('span', { text: R.geoUp ? `of people can be warned: ${fmt(gain)} million more people, with field data arriving ${fmt((TODAY.syncDays[0] * 1440) / R.metrics.p95Fast, 0)}–${fmt((TODAY.syncDays[1] * 1440) / R.metrics.p95Fast, 0)}× faster` : 'of people can be warned: turn the GEO payload back on to see the gain' })),
    compareCard(),
    el('p', { class: 'co-foot' }, '* modeled proxy · the other figures are the RFP\'s, for Central and West Africa.'));
}

function compareCard() {
  const rows = compareToday(R, G.todayNow, S.sensors.gauge);
  const change = r => {
    if (r.factorRange) return `${fmt(r.factorRange[0], 0)}–${fmt(r.factorRange[1], 0)}× faster`;
    if (r.factor != null) return r.good === 'low' ? `${fmt(r.factor, r.factor < 10 ? 1 : 0)}× faster` : `${fmt(r.factor, r.factor < 10 ? 1 : 0)}×`;
    if (r.change != null) return `+${fmt(r.change, 0)} ${r.unit}${r.extra ? ` · ${r.extra}` : ''}`;
    return r.now === 'no' ? 'no change' : 'new';
  };
  const bad = r => r.now === 'no' || r.now === 'no alert path';
  const body = el('div', { class: 'co-cmp', role: 'table', 'aria-label': 'Today against the current S-3 design' },
    el('div', { class: 'co-cmp-h', role: 'row' }, el('span', { text: '' }), el('span', { text: 'Today' }), el('span', { text: 'With S-3' }), el('span', { text: 'Change' })),
    rows.map(r => el('div', { class: `co-cmp-r${bad(r) ? ' is-bad' : ''}`, role: 'row', tabindex: 0,
      onpointermove: ev => showTip(ev, [el('b', { text: r.label }), el('div', { text: r.note }), el('div', { class: 'k', text: r.kind === 'sourced' ? 'Today figure: RFP S-3 brief' : r.kind === 'proxy' ? 'Modeled proxy' : 'This model (assumptions)' })]),
      onpointerleave: hideTip },
    el('span', { class: 'co-cmp-l', text: r.label }), el('span', { class: 'co-cmp-t', text: r.today }), el('span', { class: 'co-cmp-n', text: r.now }),
    el('span', { class: 'co-cmp-c', text: change(r) }), el('i', { class: `co-cmp-k is-${r.kind}`, title: r.kind === 'sourced' ? 'RFP figure' : r.kind === 'proxy' ? 'Modeled proxy' : 'Model', text: r.kind === 'sourced' ? 'RFP' : r.kind === 'proxy' ? 'proxy' : 'model' }))));
  const table = [['Measure', 'Today', 'With S-3', 'Change', 'Basis'], ...rows.map(r => [r.label, r.today, r.now, change(r), r.kind === 'sourced' ? 'RFP' : r.kind === 'proxy' ? 'Modeled proxy' : 'Model'])];
  return chartBlock('co-today', 'Today vs the S-3 design', body, table);
}

// ---------- legend (changes with the step; in "what" every item that can be switched is a button) ----------
function renderLegend() {
  if (S.step === 'why') {
    const item = (sw, text) => el('span', { class: 'co-lg is-fixed' }, el('i', { class: 'co-sw', style: sw }), text);
    $('.co-legend').replaceChildren(el('div', { class: 'co-lgroup' },
      item('background:linear-gradient(90deg,var(--seq-1),var(--seq-6))', 'People per km²'), item('background:var(--critical);border-radius:50%;opacity:.7', 'Conflict (size = deaths)'),
      item('background:var(--s2);border-radius:50%', 'Fire'), item('background:var(--river);border-radius:50%', 'Flood alert'),
      item('border:1px dashed var(--s6)', 'Protected area'), item('background:var(--text)', 'Infrastructure')));
    return;
  }
  if (S.step === 'kit') {
    const item = (sw, text) => el('span', { class: 'co-lg is-fixed' }, el('i', { class: 'co-sw', style: sw }), text);
    $('.co-legend').replaceChildren(el('div', { class: 'co-lgroup' }, el('b', { text: 'Station design' }),
      item('background:var(--text)', 'Main station (shape = access)'), item('border:1.5px solid var(--s5)', 'Waypoint post'), item('background:var(--gold);opacity:.3', 'Speakers (faint)')));
    return;
  }
  if (S.step === 'alerts' || S.step === 'stations') {
    const item = (sw, text) => el('span', { class: 'co-lg is-fixed' }, el('i', { class: 'co-sw', style: sw }), text);
    $('.co-legend').replaceChildren(el('div', { class: 'co-lgroup' }, el('b', { text: S.step === 'alerts' ? 'Alerts (GRID3 in the DRC)' : 'Stations from speakers' }),
      ...(S.step === 'alerts'
        ? [item('background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 25%,transparent),var(--gold))', 'Village speakers per area'), item('background:var(--river);border-radius:50%;opacity:.6', 'Receivers'), item('border:1.5px solid var(--s2)', 'Urban centre'), item('background:var(--rust-hi);opacity:.4', 'Hazard score')]
        : [item('background:var(--text)', 'Station (shape = access)'), item('background:var(--text);height:2px', 'Speaker area → its station'), item('border:1.5px solid var(--muted)', 'SRR station'), item('background:var(--gold);border-radius:50%;opacity:.4', 'Speakers (faint)')])));
    return;
  }
  if (S.step === 'today') {
    const t = (key, sw, text) => el('button', { class: 'co-lg', 'aria-pressed': String(!!S.today[key]), title: `Show or hide: ${text}`,
      onclick: () => { S.today[key] = !S.today[key]; map.drawToday(S); renderLegend(); } }, el('i', { class: 'co-sw', style: sw }), text);
    $('.co-legend').replaceChildren(el('div', { class: 'co-lgroup' }, el('b', { text: 'Existing networks (modeled proxy)' }),
      t('reached', 'background:var(--river);opacity:.8', 'People reached today'), t('unreached', 'background:var(--rust-hi);opacity:.7', 'People with no network'),
      t('rings', 'border:1.5px solid var(--river);border-radius:50%', "Each town's reach"), t('infra', 'background:var(--text)', 'Infrastructure')));
    return;
  }
  const tog = (key, sw, text) => el('button', { class: 'co-lg', 'aria-pressed': String(!!S.show[key]), title: `Show or hide: ${text}`,
    onclick: () => { S.show[key] = !S.show[key]; if (key.startsWith('flow')) map.sync(S); else if (key === 'hud') renderHud(); else map.drawWhat(S, R); renderLegend(); } },
  el('i', { class: 'co-sw', style: sw }), text);
  const fixed = (sw, text) => el('span', { class: 'co-lg is-fixed' }, el('i', { class: 'co-sw', style: sw }), text);
  const grp = (title, ...items) => el('div', { class: 'co-lgroup' }, el('b', { text: title }), ...items);
  const lane = v => `height:4px;border-radius:2px;background:repeating-linear-gradient(90deg,var(${v}) 0 5px,transparent 5px 8px)`;
  $('.co-legend').replaceChildren(
    grp('Built', fixed('background:var(--s5);outline:1.5px solid var(--paper)', 'Database node'), fixed('background:var(--text);border-radius:50%', 'Ranger station'),
      fixed('background:var(--precip);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)', 'Repeater'), tog('geo', 'border:2.5px solid var(--alert)', 'GEO alert footprint')),
    grp('Coverage', tog('coverage', 'background:var(--gold);opacity:.75', 'People within reach'), tog('reach', 'border:1.5px solid var(--river);border-radius:50%', 'Station / repeater reach')),
    grp('Sensors', ...Object.entries(FAMILY).map(([k, f]) => tog(k, `background:var(${f.col});border-radius:50%`, f.name.split(':')[0])),
      fixed('border:1.5px solid var(--critical);border-radius:50%', 'Misses S3-03')),
    grp('Data flow', tog('flowUp', lane('--data'), 'Sensor data ↑'), tog('flowAlert', lane('--alert'), 'Alerts ↓'), tog('flowTwo', lane('--s7'), 'Two-way ↔'),
      tog('hud', 'background:var(--glass);border:1px solid var(--line-2)', 'Numbers')),
  );
}

// ---------- the numbers on the map: time, data, reach, cost, each against the baseline ----------
function renderHud() {
  hud.hidden = !S.show.hud;
  if (!S.show.hud) return;
  const m = R.metrics, b = base.metrics;
  // kind: 'low' = lower is better, 'high' = higher is better, 'neutral' = neither
  const delta = (v, bv, unit, kind, digits = 1) => {
    const d = v - bv;
    if (!Number.isFinite(v) || !Number.isFinite(bv) || Math.abs(d) < 10 ** -digits / 2) return null;
    const cls = kind === 'neutral' ? 'is-neutral' : (kind === 'low' ? d < 0 : d > 0) ? 'is-good' : 'is-bad';
    return el('em', { class: cls, title: 'Change against the baseline design' }, `${d > 0 ? '▲' : '▼'}${fmt(Math.abs(d), digits)}${unit}`);
  };
  const min = v => (Number.isFinite(v) ? `${fmt(v, v < 10 ? 1 : 0)} min` : 'no path');
  const cell = (big, label, d, over, extra) => el('div', { class: `co-hud-c${over ? ' is-over' : ''}` }, el('b', { text: big }), d, el('span', { text: label }), extra);
  const usePct = Math.min(100, m.util * 100);
  hud.replaceChildren(
    cell(min(m.p95Fast), 'priority p95 · ≤30', delta(m.p95Fast, b.p95Fast, '', 'low'), m.p95Fast > 30),
    cell(min(m.avgCop), 'average message', delta(m.avgCop, b.avgCop, '', 'low')),
    cell(min(m.alertMin), 'alert · ≤10', delta(m.alertMin, b.alertMin, '', 'low'), m.alertMin > 10),
    cell(`${fmt(m.bytesDay / 1e6, 1)} MB`, m.saturated ? 'a day · network full' : `a day · ${fmt(usePct)}% full`, delta(m.bytesDay / 1e6, b.bytesDay / 1e6, '', 'neutral'), m.util > 0.8,
      el('i', { class: 'co-hud-bar', style: `--w:${usePct}%` })),
    cell(`${fmt(m.popPct, 1)}%`, 'people reached', delta(m.popPct, b.popPct, '', 'high')),
    cell(`$${fmt(m.costBase)}M`, `15 yr · ${fmt(m.costLow)}–${fmt(m.costHigh)}`, delta(m.costBase, b.costBase, '', 'low', 0), m.costBase > 400),
  );
}

// ---------- results: two tabs ----------
function renderResults() {
  const pane = $('.co-res .is-what');
  const tabs = el('div', { class: 'co-tabs' }, seg([['overview', 'Requirements and cost'], ['detail', 'How it adds up'], ['today', 'vs Today']], S.resTab, v => { S.resTab = v; renderResults(); }, 'Results'));
  pane.replaceChildren(tabs, ...(S.resTab === 'detail' ? detailTab() : S.resTab === 'today' ? [compareCard()] : overviewTab()));
}

function overviewTab() {
  const baseState = Object.fromEntries(base.checks.map(c => [c.id, c.state]));
  const checks = el('div', { class: 'co-checks', role: 'list', 'aria-label': 'Requirement checks' }, R.checks.map(c => {
    const changed = baseState[c.id] !== c.state;
    const chip = el('div', { class: `co-check is-${c.state}${changed ? ' is-changed' : ''}`, role: 'listitem', tabindex: 0,
      'aria-label': `${c.id} ${CHECK_FULL[c.id]}: ${c.state}. ${c.v}` },
    el('b', { text: c.id }), el('span', { text: CHECK_NAMES[c.id] }), el('i', { 'aria-hidden': 'true', text: c.state === 'pass' ? '✓' : c.state === 'near' ? '≈' : '✗' }));
    const tip = ev => showTip(ev, [el('b', { text: `${c.id} · ${CHECK_FULL[c.id]}` }), el('div', { text: c.v }), c.obj === undefined ? null : kv('Objective', c.obj ? 'met' : 'not met')]);
    chip.addEventListener('pointermove', tip); chip.addEventListener('pointerleave', hideTip);
    chip.addEventListener('focus', () => { const r = chip.getBoundingClientRect(); tip({ clientX: r.left, clientY: r.bottom }); }); chip.addEventListener('blur', hideTip);
    return chip;
  }));
  const C = R.counts;
  const count = (v, l) => el('div', { class: 'co-count' }, el('b', { text: v }), el('span', { text: l }));
  const counts = el('div', { class: 'co-counts' },
    count(fmt(C.stations), 'ranger stations'), count(fmt(C.repeaters), 'repeaters'), count(fmt(C.dbNodes), 'database nodes'),
    count(`${C.satellites}${C.geo ? ' + 1' : ''}`, `LEO${C.geo ? ' + GEO' : ''} satellites`), count(fmt(C.terminals), 'sensor terminals'), count(`${fmt(C.receivers / 1000)}k`, 'community receivers'));
  return [checks, el('h3', { class: 'co-h', text: 'How many' }), counts, costChart()];
}

// ---------- "How it adds up": what one lever does to everything, the time and data behind the numbers, the formulas ----------
const LEVERS = {
  leoSats: { name: 'Satellites', xs: () => LEO_SIZES, set: v => ({ leoSats: v }), cur: () => S.leoSats, fmtX: v => String(v) },
  n: { name: 'Stations', xs: () => [10, 25, 50, 75, spot.knee, 100, 150, 200, 300, 400].sort((a, b) => a - b), set: v => ({ n: v }), cur: () => S.n, fmtX: v => String(v) },
  repeaters: { name: 'Repeaters', xs: () => [0, 25, 50, 100, 150, 200, 300], set: v => ({ repeaters: v }), cur: () => S.repeaters, fmtX: v => String(v) },
  sensors: {
    name: 'Sensors', xs: () => [0.5, 1, 1.5, 2, 2.5, 3],
    set: f => ({ sensors: Object.fromEntries(D.sn.types.map(t => [t.id, Math.round(t.baseline_count * f)])) }),
    cur: () => D.sn.types.reduce((a, t) => a + S.sensors[t.id], 0) / D.sn.types.reduce((a, t) => a + t.baseline_count, 0), fmtX: v => `×${v}`,
  },
};
const sweepCache = new Map();
function sweep(key) {
  const L = LEVERS[key], sig = `${key}|${S.year}|${JSON.stringify({ ...opts(), [key]: null, ...(key === 'sensors' ? { sensors: null } : {}) })}`;
  if (!sweepCache.has(sig)) sweepCache.set(sig, L.xs().map(x => ({ x, m: evaluate(D, G.st, { ...opts(), ...L.set(x) }).metrics })));
  return sweepCache.get(sig);
}

function mini({ title, pts, series, ref, refLabel, cur, yFmt, xFmt }) {
  const W = 168, H = 104, m = { l: 34, r: 6, t: 16, b: 18 };
  const vals = series.flatMap(s => pts.map(p => s.y(p.m))).filter(Number.isFinite).concat(ref ?? []);
  const yMax = Math.max(1, ...vals) * 1.08, yMin = 0;
  const xs = pts.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = v => m.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - m.l - m.r), Y = v => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg co-mini', role: 'img', 'aria-label': title });
  svText(s, { x: 2, y: 10, class: 'lbl' }, title);
  for (const v of [0, yMax / 2]) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'gl' }, s); svText(s, { x: m.l - 3, y: Y(v) + 3, 'text-anchor': 'end', class: 'axl' }, yFmt(v)); }
  if (ref != null && ref <= yMax) { sv('line', { x1: m.l, x2: W - m.r, y1: Y(ref), y2: Y(ref), stroke: 'var(--critical)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, s); svText(s, { x: W - m.r, y: Y(ref) - 3, 'text-anchor': 'end', class: 'sub', fill: 'var(--critical)' }, refLabel); }
  for (const sr of series) {
    const d = pts.map(p => [X(p.x), sr.y(p.m)]).filter(([, v]) => Number.isFinite(v)).map(([px_, v], i) => `${i ? 'L' : 'M'}${px_.toFixed(1)},${Y(v).toFixed(1)}`).join('');
    sv('path', { d, fill: 'none', stroke: `var(${sr.col})`, 'stroke-width': 2, 'stroke-dasharray': sr.dash || null }, s);
  }
  if (cur != null) sv('line', { x1: X(cur), x2: X(cur), y1: m.t, y2: H - m.b, class: 'cursor' }, s);
  svText(s, { x: m.l, y: H - 5, class: 'axl' }, xFmt(x0)); svText(s, { x: W - m.r, y: H - 5, 'text-anchor': 'end', class: 'axl' }, xFmt(x1));
  return s;
}

function detailTab() {
  const L = LEVERS[S.sweep], pts = sweep(S.sweep), cur = Math.min(Math.max(L.cur(), Math.min(...pts.map(p => p.x))), Math.max(...pts.map(p => p.x)));
  const min = v => `${fmt(v)}`;
  const grid = el('div', { class: 'co-minis' },
    mini({ title: '15-yr cost, $M', pts, series: [{ y: m => m.costBase, col: '--s4' }, { y: m => m.costHigh, col: '--s4', dash: '2 3' }], ref: 400, refLabel: 'cap', cur, yFmt: min, xFmt: L.fmtX }),
    mini({ title: 'Time to COP, min', pts, series: [{ y: m => m.p95Fast, col: '--s1' }, { y: m => m.avgCop, col: '--s1', dash: '3 3' }], ref: 30, refLabel: '30 min', cur, yFmt: min, xFmt: L.fmtX }),
    mini({ title: 'Network capacity used, %', pts, series: [{ y: m => Math.min(120, m.util * 100), col: '--data' }], ref: 100, refLabel: 'full', cur, yFmt: min, xFmt: L.fmtX }),
    mini({ title: 'Reach, %', pts, series: [{ y: m => m.popPct, col: '--gold' }, { y: m => m.fastShare * 100, col: '--s6', dash: '3 3' }], cur, yFmt: min, xFmt: L.fmtX }),
  );
  const rows = [['Lever value', 'Cost $M', 'p95 to COP', 'Average', 'Capacity used', 'People reached', 'Fast-path sensors'],
    ...pts.map(p => [L.fmtX(p.x), fmt(p.m.costBase), fmt(p.m.p95Fast, 1), fmt(p.m.avgCop, 1), `${fmt(p.m.util * 100)}%`, `${fmt(p.m.popPct, 1)}%`, `${fmt(p.m.fastShare * 100)}%`])];
  const sweepCard = chartBlock('co-sweep', `What ${L.name.toLowerCase()} change`, el('div', {},
    el('div', { class: 'co-slot co-lever' }, el('span', { class: 'co-sub', text: 'Vary' }), seg(Object.entries(LEVERS).map(([k, l]) => [k, l.name]), S.sweep, v => { S.sweep = v; renderResults(); }, 'Lever to vary')),
    grid, el('p', { class: 'co-note', text: 'Everything else stays as set. Solid: cost (base), p95 priority time, capacity used, people reached. Dashed: cost (high), average message, priority sensors on a fast path. The line marks the current value.' })), rows);
  return [sweepCard, timeCard(), dataCard(), formulas()];
}

function timeCard() {
  const A = ASSUME, lr = R.leo.row, m = R.metrics, F = A.s303FixedMin.threshold;
  const bars = [
    { label: 'Priority, fast path', parts: [['Acquire (F1)', 2, '--s4'], ['Wait for a pass (p95)', lr.open_sky_20deg.p95_wait_min, '--s1'], ['Queue', m.qPrio, '--critical'], ['Process (F3)', F - 2, '--s3']], ref: 30 },
    { label: 'Priority, under canopy', parts: [['Acquire (F1)', 2, '--s4'], ['Wait for a pass (p95)', lr.under_canopy_45deg.p95_wait_min, '--s1'], ['Queue', m.qPrio, '--critical'], ['Process (F3)', F - 2, '--s3']], ref: 30 },
    { label: 'Average message', parts: [['Acquire + process', F, '--s4'], ['Average wait', m.avgCop - F - m.qRoutine, '--s1'], ['Queue', m.qRoutine, '--critical']] },
    { label: 'Alert to audible', parts: [['Authorize and hand over', 2, '--s4'], ['GEO broadcast', 0.5, '--alert'], ['Playback', 1, '--s3']], ref: 10 },
  ];
  const W = 340, rowH = 30, top = 6, left = 108, max = 60, X = v => left + (Math.min(v, max) / max) * (W - left - 30);
  const s = sv('svg', { viewBox: `0 0 ${W} ${top + bars.length * rowH + 14}`, class: 'vsvg', role: 'img', 'aria-label': 'Where the time goes, in minutes' });
  bars.forEach((b, i) => {
    const y = top + i * rowH; let acc = 0;
    svText(s, { x: 0, y: y + 13, class: 'lbl' }, b.label);
    for (const [name, v, col] of b.parts) {
      if (!Number.isFinite(v) || v <= 0) continue;
      const r = sv('rect', { x: X(acc), y: y + 2, width: Math.max(0.8, X(acc + v) - X(acc)), height: 14, fill: `var(${col})` }, s);
      sv('title', {}, r).textContent = `${name}: ${fmt(v, 1)} min`; acc += v;
    }
    svText(s, { x: Math.min(X(acc) + 4, W - 2), y: y + 13, class: 'sub', 'text-anchor': acc > max ? 'end' : 'start' }, `${fmt(acc, acc < 10 ? 1 : 0)} min${acc > max ? ' →' : ''}`);
    if (b.ref) sv('line', { x1: X(b.ref), x2: X(b.ref), y1: y, y2: y + 18, stroke: 'var(--critical)', 'stroke-dasharray': '2 2' }, s);
  });
  const rows = [['Path', 'Part', 'Minutes'], ...bars.flatMap(b => b.parts.map(([n, v]) => [b.label, n, fmt(v, 1)]))];
  return chartBlock('co-time', 'Where the time goes (min)', el('div', {}, s, el('div', { class: 'v2-legend' },
    [['Acquire / process', '--s4'], ['Waiting for a satellite', '--s1'], ['Queue (congestion)', '--critical']].map(([t, c]) => el('span', {}, el('i', { style: `background:var(${c})` }), t)))), rows);
}

function dataCard() {
  const m = R.metrics, W = 340, cap = m.capacity, max = Math.max(cap, m.bytesDay) * 1.05, X = v => 4 + (v / max) * (W - 8);
  const s = sv('svg', { viewBox: `0 0 ${W} 62`, class: 'vsvg', role: 'img', 'aria-label': `Sensor data ${fmt(m.bytesDay / 1e6, 1)} MB per day against ${fmt(cap / 1e6)} MB per day capacity` });
  let acc = 0;
  for (const t of m.byType) {
    const col = FAMILY[familyOf(t.id)].col, r = sv('rect', { x: X(acc), y: 8, width: Math.max(0.5, X(acc + t.bytes) - X(acc)), height: 18, fill: `var(${col})`, stroke: 'var(--bg)', 'stroke-width': 0.6 }, s);
    sv('title', {}, r).textContent = `${t.name}: ${fmt(t.count)} × → ${fmt(t.bytes / 1e6, 2)} MB/day`; acc += t.bytes;
  }
  sv('line', { x1: X(cap), x2: X(cap), y1: 2, y2: 36, stroke: 'var(--critical)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, s);
  svText(s, { x: Math.min(X(cap), W - 4), y: 48, 'text-anchor': 'end', class: 'sub', fill: 'var(--critical)' }, `capacity ${fmt(cap / 1e6)} MB/day`);
  svText(s, { x: 4, y: 48, class: 'lbl' }, `${fmt(m.bytesDay / 1e6, 1)} MB/day · ${m.saturated ? 'saturated' : `${fmt(m.util * 100)}% used`}`);
  const rows = [['Sensor type', 'Count', 'Bytes per day each', 'MB per day'], ...m.byType.map(t => [t.name, fmt(t.count), fmt(D.sn.types.find(x => x.id === t.id).bytes_per_day), fmt(t.bytes / 1e6, 2)])];
  return chartBlock('co-data', 'Data handled per day', el('div', {}, s, el('div', { class: 'v2-legend' },
    Object.values(FAMILY).map(f => el('span', {}, el('i', { style: `background:var(${f.col})` }), f.name.split(':')[0])))), rows);
}

function formulas() {
  const A = ASSUME, m = R.metrics, lr = R.leo.row, f = (v, d = 1) => fmt(v, d);
  const items = [
    ['Capacity', `${A.leoKbpsPerSat} kbps × 86,400 s × ${f(lr.open_sky_20deg.pct_time_in_contact, 0)}% of the day with a satellite in view = ${f(m.capacity / 1e6, 0)} MB/day`],
    ['Use', `${f(m.bytesDay / 1e6)} MB sensor data ÷ ${f(m.capacity / 1e6, 0)} MB capacity = ${f(m.util * 100, 0)}%`],
    ['Queue', m.saturated ? 'network saturated: routine data backs up' : `average wait ${f(lr.open_sky_20deg.mean_wait_min)} min × u/(1−u) = ${f(m.qRoutine)} min (priority sees half: ${f(m.qPrio)} min)`],
    ['Priority to COP', `F1 2 + p95 wait ${f(lr.open_sky_20deg.p95_wait_min)} + queue ${f(m.qPrio)} + F3 ${A.s303FixedMin.threshold - 2} = ${f(m.p95Fast)} min (under canopy ${f(m.p95Canopy, 0)} min)`],
    ['Within 30 min', `${f(m.fastShare * 100, 0)}% of priority sensors on a fast path (open sky, raised antenna or relay) → ${f(m.within30 * 100, 0)}% within 30 min`],
    ['Average message', `12 + ${f(m.fastShareAll * 100, 0)}% × ${f(lr.open_sky_20deg.mean_wait_min)} + ${f(100 - m.fastShareAll * 100, 0)}% × ${f(lr.under_canopy_45deg.mean_wait_min)} + queue ${f(m.qRoutine)} = ${f(m.avgCop)} min`],
    ['Alert to audible', `authorize 2 + GEO 0.5 + playback 1 = ${f(m.alertMin)} min`],
    ['S-3 share of warning', `priority ${f(m.p95Fast)} + alert ${f(m.alertMin)} = ${f(m.s3Chain)} min (agency evaluation F4–F5 not included)`],
    ['People reached', `station curve at ${S.n} stations = ${f(m.popPct)}% (${f(m.peopleReached / 1e6)}M people)`],
    ['Availability', `${A.avail.space * 100}% space × ${A.avail.rain * 100}% rain × (1 − 0.01^${S.nodes.length - (R.hubDown ? 1 : 0)}) ground = ${f(R.avail * 100, 2)}%`],
    ['Cost', `${R.lines.map(l => `${l.name.replace(/ \(.*\)/, '')} ${fmtM(l.base)}`).join(' + ')} = ${fmtM(m.costBase)}`],
    ['Value', `stations ${m.costPerPerson ? `$${f(m.costPerPerson, 2)}` : '–'} per person reached; whole system $${f(m.costPerTerminalYr, 0)} per sensor terminal per year`],
  ];
  return el('div', { class: 'vcard co-formulas' }, el('div', { class: 'vcard-h' }, el('h3', { text: 'The formulas, with today\'s numbers' }), tag('Illustrative')),
    el('dl', {}, items.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
}

function costChart() {
  const W = 340, H = 104, cap = D.cost.budget.lcc_cap_usd / 1e6, max = Math.max(R.total.high, cap) * 1.06, x = v => 8 + (v / max) * (W - 16);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg', role: 'img', 'aria-label': `15-year cost ${fmtM(R.total.base)}, range ${fmtM(R.total.low)} to ${fmtM(R.total.high)}, against the ${fmtM(cap)} cap` });
  let acc = 0;
  for (const l of R.lines) {
    const w = x(acc + l.base) - x(acc);
    const r = sv('rect', { x: x(acc), y: 22, width: Math.max(0.5, w), height: 20, fill: `var(${LINE_COL[l.k] || '--neu-4'})` }, s);
    sv('title', {}, r).textContent = `${l.name}: ${fmtM(l.base)} (${fmtM(l.low)}–${fmtM(l.high)})`;
    acc += l.base;
  }
  sv('line', { x1: x(R.total.low), x2: x(R.total.high), y1: 56, y2: 56, stroke: 'var(--text)', 'stroke-width': 1.5 }, s);
  for (const v of [R.total.low, R.total.high]) sv('line', { x1: x(v), x2: x(v), y1: 51, y2: 61, stroke: 'var(--text)', 'stroke-width': 1.5 }, s);
  sv('circle', { cx: x(R.total.base), cy: 56, r: 3.5, fill: 'var(--text)' }, s);
  svText(s, { x: x(R.total.low), y: 74, 'text-anchor': 'middle', class: 'sub' }, fmtM(R.total.low));
  svText(s, { x: x(R.total.high), y: 74, 'text-anchor': 'end', class: 'sub' }, fmtM(R.total.high));
  sv('line', { x1: x(cap), x2: x(cap), y1: 10, y2: 84, stroke: 'var(--critical)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, s);
  svText(s, { x: x(cap), y: 96, 'text-anchor': 'middle', class: 'lbl', fill: 'var(--critical)' }, `$${cap}M cap`);
  svText(s, { x: 8, y: 14, class: 'lbl' }, `Base ${fmtM(R.total.base)}`);
  const d = R.total.base - base.total.base;
  if (Math.abs(d) >= 0.5) svText(s, { x: W - 8, y: 14, 'text-anchor': 'end', class: d > 0 ? 'sub co-up' : 'sub co-down' }, `${d > 0 ? '+' : '−'}${fmtM(Math.abs(d))} vs baseline`);
  const legend = el('div', { class: 'v2-legend co-costlegend' }, R.lines.map(l => el('span', {}, el('i', { style: `background:var(${LINE_COL[l.k] || '--neu-4'})` }), `${l.name.replace(/ \(.*\)/, '')} ${fmtM(l.base)}`)));
  const rows = [['Line', 'Low', 'Base', 'High'], ...R.lines.map(l => [l.name, fmtM(l.low), fmtM(l.base), fmtM(l.high)]), ['Total', fmtM(R.total.low), fmtM(R.total.base), fmtM(R.total.high)]];
  return chartBlock('co-cost', '15-year cost range', el('div', {}, s, legend), rows);
}

function curveChart() {
  const run = G.st.runs[S.mode], st = run.stations, W = 300, H = 118, m = { l: 32, r: 8, t: 8, b: 22 };
  const NM = st.length, yMax = Math.ceil(st[NM - 1].cum_pct / 10) * 10, x = n => m.l + (n / NM) * (W - m.l - m.r), y = p => H - m.b - (p / yMax) * (H - m.t - m.b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg', role: 'img', 'aria-label': `People within reach of ranger stations: ${fmt(R.popPct, 1)}% with ${S.n} stations; sweet spot ${spot.knee}, range ${spot.lo} to ${spot.hi}` });
  sv('rect', { x: x(spot.lo), y: m.t, width: x(spot.hi) - x(spot.lo), height: H - m.t - m.b, fill: 'var(--accent)', opacity: 0.1 }, s);
  for (const p of [0, yMax / 2, yMax]) { sv('line', { x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), class: 'gl' }, s); svText(s, { x: m.l - 4, y: y(p) + 3, 'text-anchor': 'end', class: 'axl' }, `${p}%`); }
  for (const f of [0, 0.25, 0.5, 0.75, 1]) svText(s, { x: x(Math.round(NM * f)), y: H - 10, 'text-anchor': 'middle', class: 'axl' }, String(Math.round(NM * f)));
  sv('path', { d: `M${x(0)},${y(0)}${st.map((p, i) => `L${x(i + 1).toFixed(1)},${y(p.cum_pct).toFixed(1)}`).join('')}`, fill: 'none', stroke: `var(${MODES[S.mode].color})`, 'stroke-width': 2 }, s);
  sv('circle', { cx: x(spot.knee), cy: y(st[spot.knee - 1].cum_pct), r: 3.5, fill: 'var(--accent)' }, s);
  svText(s, { x: x(spot.knee) + 6, y: y(st[spot.knee - 1].cum_pct) + 14, class: 'sub' }, `sweet spot ${spot.knee}`);
  if (S.n > 0) {
    const p = st[S.n - 1];
    sv('line', { x1: x(S.n), x2: x(S.n), y1: m.t, y2: H - m.b, class: 'cursor' }, s);
    svText(s, { x: Math.min(x(S.n) + 5, W - 116), y: m.t + 10, class: 'lbl' }, `${fmt(p.cum_pct, 1)}% · $${fmt(p.cum_cost_musd, 1)}M`);
  }
  const rows = [['Stations', 'People within reach', '15-yr cost'], ...[...new Set([20, 40, 60, spot.knee, 100, 150, 200, 300, 400, NM])].filter(n => n <= NM).sort((a, b) => a - b).map(n => [String(n), `${fmt(st[n - 1].cum_pct, 1)}%`, `$${fmt(st[n - 1].cum_cost_musd, 1)}M`])];
  return chartBlock('co-curve', 'People within reach', s, rows);
}
