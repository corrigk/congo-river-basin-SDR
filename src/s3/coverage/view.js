// Design tab, the alerting chain (brief v3). Stage 1 has two steps:
//   hear   Who must hear the alert: three meanings of "covered", what S3-05 asks, who counts, the four ways to make
//          the sound, and the scale check that shows why village speakers alone cannot carry it
//   sound  How far a voice carries: the acoustic model, live, with the sound profile out of a village into forest
// Later stages add where speakers go, who looks after them, ranger reach and sensors (docs/sdr-plan.md).
import { D } from '../v2/data.js';
import { el, seg, tag, fmt, sv, svText, chartBlock, card, showTip, hideTip, kv } from '../v2/ui.js';
import { reqBy } from '../content.js';
import { stepBar } from '../steps.js';
import { level, rangeTo, threshold, paths, briefTable, value, PARAMS, CASES, areaKm2 } from './acoustics.js';
import URB from '../../../analysis/data/urbanisation.json' with { type: 'json' };
import PROF from '../../../analysis/data/profiles_pilot.json' with { type: 'json' };
import '../v2/v2.css';
import '../conops/conops.css';
import '../../sdr/sdr.css'; // shared controls: sliders, chips, buttons, legends
import './coverage.css';

const BARE = Object.values(import.meta.glob('../../../designs/bare-minimum.json', { eager: true, import: 'default' }))[0];
const SRR_STATIONS = D.budget.sweet_spots.find(s => s.run === 'mix_2041')?.stations ?? 78;
const YEAR = '2041';

// Sound-step settings: speaker, listening case and the path parameters (base values to start).
const S = {
  step: 'hear',
  spk: 't1', L0: value('src_t1_db'), caseId: 'night', ambient: value('ambient_night_dba'),
  dLand: value('d_land_db'), dWater: value('d_water_db'), air: value('air_db_km'), forest: value('forest_db_100m'), clearing: value('clearing_m'),
  pSpk: 0, pBrg: 0, // the pilot's real-terrain profile: which speaker and bearing
};
let root = null;
const $ = s => root.querySelector(s);
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== ''));

export function mount(host, step = 'hear') {
  root = host;
  S.step = step;
  root.innerHTML = `
    <div class="cv" data-step="${step}">
      <header class="co-head">
        <div><div class="pv-eyebrow">Design · the alerting chain</div>
          <h2 class="co-title"><span class="cv-t-hear">Who must hear the alert</span><span class="cv-t-sound">How far a voice carries</span></h2></div>
        <div class="co-stepbar">${stepBar(step)}</div>
      </header>
      <div class="cv-body"></div>
    </div>`;
  render();
}
export function setStep(step) {
  if (!root || !['hear', 'sound'].includes(step)) return;
  S.step = step;
  $('.cv').dataset.step = step;
  $('.co-stepbar').innerHTML = stepBar(step);
  hideTip();
  render();
}
export function refit() { if (root) render(); }

function render() { fill($('.cv-body'), S.step === 'sound' ? soundStep() : hearStep()); }

// ---------- the radius a village speaker reaches, for the scale check (base values, design case) ----------
function designRadius(bands = {}) {
  const v = id => value(id, bands[id] || 'base');
  return rangeTo(threshold('night', bands), { L0: v('src_t1_db'), D: v('d_land_db'), airDbKm: v('air_db_km'), forestDb100: v('forest_db_100m'), clearingM: v('clearing_m') });
}

// ---------- step: who must hear the alert ----------
function hearStep() {
  const yr = URB.by_year[YEAR], recv = D.sn.community_receivers[YEAR];
  const s305 = reqBy['S3-05'], s307 = reqBy['S3-07'];
  const defs = card('Three different "covered"',
    el('div', { class: 'cv-defs' }, [
      ['Audible', 'Share of people standing where a speaker\'s voice is loud enough to hear (at least 10 dB above the background noise).', 'Static: speakers, terrain, forest, noise', 'This tab'],
      ['Alert time', 'Share of receivers that sound within 10 minutes of the authorized alert.', 'Time: GEO broadcast, processing, playback', 'S3-05 (RFP)'],
      ['Ranger reach', 'Share of people a ranger can physically reach within a given time.', 'Time: stations, boats, roads, foot', 'Stage 4'],
    ].map(([k, what, how, where]) => el('div', { class: 'cv-def' }, el('b', { text: k }), el('span', { text: what }), el('small', { text: `${how} · ${where}` })))),
    el('p', { class: 'cv-key' }, 'People who hear a warning in time ≈ ', el('b', { text: 'audible × alert time' }),
      '. If only 70% of people are where a voice carries, no satellite speed gets the alert to more of them: audibility is the binding limit, and placing speakers is its job.'));

  const req = card('What S-3 must deliver',
    el('div', { class: 'cv-req' }, el('span', { class: 'cv-id', text: 'S3-05' }), el('div', {},
      el('b', { text: s305.name }), el('div', { text: `Threshold: ${s305.t}. Objective: ${s305.o}.` }))),
    el('div', { class: 'cv-req' }, el('span', { class: 'cv-id', text: 'S3-07' }), el('div', {},
      el('b', { text: s307.name }), el('div', { text: `Threshold: ${s307.t}. Objective: ${s307.o}.` }))),
    el('p', { class: 'cv-note' }, tag('Team decision', 'baseline'),
      ' S3-05 counts receivers, not people. Every village speaker carries the same GEO receiver as the $25 community receiver, so ',
      el('b', { text: 'each village speaker counts as an S3-05 receiver' }),
      '. How many people can hear an alert is reported as information, with 95% as a reference line, not as a requirement.'));

  const rows = [
    ['All basin residents', yr.total, 'Reported for honesty', '--s1'],
    ['Rural + towns and peri-urban', yr.town_periurban + yr.rural, 'The design population: the system\'s real job', '--good'],
    ['Urban centres (33)', yr.urban_centre, 'Phones (cell broadcast) and radio reach these first', '--s2'],
  ];
  const pops = chartBlock('cv-pop', `Who counts, ${YEAR}`, el('div', { class: 'cv-pops' }, rows.map(([k, v, why, c]) => el('div', { class: 'cv-pop' },
    el('span', { class: 'cv-pop-k', text: k }), el('div', { class: 'cv-bar' }, el('i', { style: `width:${(v / yr.total) * 100}%;background:var(${c})` })),
    el('b', { text: `${fmt(v / 1e6, 1)}M` }), el('small', { text: `${fmt((v / yr.total) * 100)}% · ${why}` }))),
  el('p', { class: 'cv-note' }, tag('Modeled proxy', 'proxy'), ` Degree of Urbanisation on WorldPop 2020 1 km, shares held to ${YEAR}. Ranger-served area comes with the stations (Stage 4).`)),
  [['Population', `People ${YEAR}`, 'Share'], ...rows.map(([k, v]) => [k, fmt(v), `${fmt((v / yr.total) * 100, 1)}%`])]);

  const tiers = card('Four ways to make the sound', el('table', { class: 'vtable cv-tiers' },
    el('thead', {}, el('tr', {}, ['', 'Device', 'Where', 'Heard by', 'Looked after by'].map(h => el('th', { text: h })))),
    el('tbody', {}, [
      ['T0', 'Station tower array (3.2 kW, in the cost model)', 'Ranger stations', 'People near the station and the crew', 'Rangers'],
      ['T1', 'Village speaker: solar voice speaker with the S3-07 GEO receiver built in', 'Villages, towns, river ports, markets', 'Everyone outdoors and most indoors within its range', 'Rangers'],
      ['T2', 'Community receiver, $25 solar/crank (S3-07)', 'Hamlets, homes, chiefs, health posts', 'People in and around that building', 'Communities and health workers'],
      ['T3', 'Phones: cell broadcast, direct-to-cell text', 'Cities and towns with coverage', 'Phone holders', 'National operators'],
    ].map(r => el('tr', {}, r.map((c, i) => el(i ? 'td' : 'th', { text: c, scope: i ? null : 'row' })))))),
  el('p', { class: 'cv-note' }, tag('Team decision', 'baseline'), ' Rangers keep the tower and village speakers; communities and health workers keep the $25 receivers.'));

  return [el('div', { class: 'cv-grid' }, defs, req), el('div', { class: 'cv-grid' }, pops, scaleCard(recv)), el('div', { class: 'cv-grid' }, tiers, draftsCard())];
}

// The scale check (brief §4.2): one village speaker in every village is far too many to build or maintain.
function scaleCard(recv) {
  const ppl = value('people_per_village'), villages = recv.rural_pop / ppl;
  const r = designRadius(), rLo = designRadius({ forest_db_100m: 'high', src_t1_db: 'low' }), rHi = designRadius({ forest_db_100m: 'low', src_t1_db: 'high' });
  const usd = ['low', 'base', 'high'].map(b => (villages * value('t1_installed_usd', b)) / 1e6);
  const perSt = n => villages / Math.max(1, n);
  const line = (big, text) => el('div', { class: 'cv-scale-r' }, el('b', { text: big }), el('span', { text }));
  return card('The scale check: why village speakers alone cannot carry it',
    el('div', { class: 'cv-scale' },
      line(`${fmt(recv.rural_pop / 1e6, 1)}M`, `rural people in ${YEAR} (the receiver model)`),
      line(`≈ ${fmt(villages / 1000)}k`, `villages of about ${ppl} people: one receiver each today`),
      line(`${fmt(r)} m`, `how far a village speaker's voice carries at night, out of a ${value('clearing_m')} m clearing into forest (${fmt(rLo)}–${fmt(rHi)} m across the range). One speaker covers one village, not a region.`),
      line(`≈ ${fmt(villages / 1000)}k speakers`, 'if every village gets one'),
      line(`${fmt(perSt(SRR_STATIONS))} per station`, `with the SRR's ${SRR_STATIONS} stations to look after them (${fmt(perSt(BARE?.n ?? 2))} with the bare minimum's ${BARE?.n ?? 2})`),
      line(`$${fmt(usd[0] / 1000, 1)}–${fmt(usd[2] / 1000, 1)}B`, `to install, at $${fmt(value('t1_installed_usd', 'low'))}–${fmt(value('t1_installed_usd', 'high'))} each (assumption), against the $400M cap for the whole system`)),
    el('p', { class: 'cv-key' }, el('b', { text: 'So the answer is a mix: ' }),
      'village speakers where people cluster (larger villages, towns, river ports, markets, mining camps), $25 receivers for the long tail of hamlets, and phones where towers already reach. Stage 3 counts it.'),
    el('p', { class: 'cv-note' }, tag('Modeled proxy', 'proxy'),
      ` Counting needs settlement data: the 1 km population grid has ${fmt(URB.settled_cells_outside_centres.count / 1e6, 1)}M settled cells outside the ${URB.urban_centres.count} urban centres, so it cannot tell a village from scattered homes. GRID3 settlements (DRC and Republic of Congo, 79% of the basin's people) come in Stage 3.`));
}

function draftsCard() {
  const rows = [
    ['TD-AUD-02', 'Every outdoor speaker is fed by the same S-3 broadcast path as community receivers, so it counts toward S3-05.', 'S3-05, S3-07', 'Adopted as the S3-05 framing'],
    ['TD-AUD-03', 'Every speaker reports "played" within the S3-09 window (≤6 h threshold, ≤15 min objective).', 'S3-09, F8', 'Draft'],
    ['TD-STA-01', 'Every speaker is assigned to one ranger station whose crew can reach it within T_maint (8 h one way, TBR).', 'MO-3', 'Draft (Stage 4)'],
    ['TD-STA-02', 'No station looks after more than X speakers (X from the crew-hours calculator, TBR).', 'MO-3', 'Draft (Stage 4)'],
    ['TD-REACH-01', 'Ranger reach is reported as curves (30 min, 1 h, 4 h, 24 h), with no target yet.', 'MO-3', 'Curves only'],
    ['TD-SEN-01', 'The highest-risk zones have under-canopy detection with a relay path meeting S3-03.', 'MO-1, S3-03', 'Draft (Stage 5)'],
    ['TD-AUD-01', 'Voice alerts audible to ≥95% of people.', 'MO-2, S3-05', 'Not adopted: S3-05 as written'],
  ];
  return card('Team-derived drafts', el('table', { class: 'vtable cv-drafts' },
    el('thead', {}, el('tr', {}, ['ID', 'Draft text', 'Parent', 'Status'].map(h => el('th', { text: h })))),
    el('tbody', {}, rows.map(r => el('tr', { class: /Not adopted/.test(r[3]) ? 'is-off' : '' }, r.map((c, i) => el(i ? 'td' : 'th', { text: c, scope: i ? null : 'row' })))))),
  el('p', { class: 'cv-note' }, tag('Team-derived (not RFP), TBR', 'assume'), ' These go to the requirements site once the team approves them.'));
}

// ---------- step: how far a voice carries ----------
function soundStep() {
  const P = paths(S), thr = thrNow();
  const R = Object.fromEntries(Object.entries(P).map(([k, o]) => [k, rangeTo(thr, o)]));
  return el('div', { class: 'cv-sound' }, controls(), el('div', { class: 'cv-main' }, profileCard(P.village, thr, R.village), terrainCard(thr, R.village), curveCard(P, thr, R)),
    el('div', { class: 'cv-side' }, resultsCard(R, thr), checkCard()));
}
const thrNow = () => S.ambient + value('margin_db') + (S.caseId === 'indoor' ? value('building_open_db') : 0);

function controls() {
  const slider = (label, key, min, max, step, unit, note) => {
    const out = el('b', { text: `${S[key]} ${unit}` });
    return el('div', { class: 'sd-num' }, el('div', { class: 'sd-num-h' }, el('span', { text: label }), out),
      el('input', { type: 'range', min, max, step, value: S[key], 'aria-label': label, oninput: e => { S[key] = +e.target.value; out.textContent = `${S[key]} ${unit}`; render(); } }),
      note ? el('small', { text: note }) : null);
  };
  const pick = (label, items, key, onPick) => el('div', { class: 'sd-num' }, el('div', { class: 'sd-num-h' }, el('span', { text: label })), seg(items, S[key], v => { onPick(v); render(); }, label));
  return el('aside', { class: 'cv-ctl', 'aria-label': 'Acoustic model settings' },
    el('h3', { class: 'sd-h', text: 'Speaker' }),
    pick('Speaker', [['t1', 'Village (T1)'], ['t0', 'Station tower (T0)']], 'spk', v => { S.spk = v; S.L0 = value(v === 't0' ? 'src_t0_db' : 'src_t1_db'); }),
    slider('Level at 100 ft', 'L0', 105, 126, 1, 'dB', S.spk === 't0' ? '3.2 kW array (cost model)' : 'Assumption: 110–120 dB for a 400–800 W voice speaker'),
    el('h3', { class: 'sd-h', text: 'Who is listening' }),
    pick('Case', Object.entries(CASES).map(([k, c]) => [k, c.label.split(',')[0] + (k === 'night' ? ' at night' : k === 'day' ? ' by day' : '')]), 'caseId', v => { S.caseId = v; S.ambient = value(v === 'day' ? 'ambient_village_day_dba' : 'ambient_night_dba'); }),
    slider('Background noise', 'ambient', 35, 65, 1, 'dBA', 'Assumption to measure: village by day 45, forest edge at night 55'),
    el('h3', { class: 'sd-h', text: 'The path' }),
    slider('Loss per doubling of distance, land', 'dLand', 6, 10, 0.5, 'dB', '6 soft ground (FEMA) to 10 vendor outdoor rule'),
    slider('Same, along the river', 'dWater', 3, 6, 0.5, 'dB', 'Water carries sound: about 3 (FEMA)'),
    slider('Air absorption', 'air', 3, 7, 0.5, 'dB/km', 'Hot, humid air at 1 kHz'),
    slider('Forest attenuation', 'forest', 1, 20, 0.2, 'dB per 100 m'),
    el('div', { class: 'cv-presets' }, el('span', { class: 'cv-note', text: 'Measured in rainforest:' }),
      [[1.9, '1.9 French Guiana'], [6.6, '6.6 FEMA woods'], [20, '20 older tropical work']].map(([v, l]) => el('button', { class: 'sd-chip', 'aria-pressed': String(Math.abs(S.forest - v) < 0.05), onclick: () => { S.forest = v; render(); }, text: l }))),
    slider('Village clearing radius', 'clearing', 100, 800, 25, 'm', 'Open ground before the trees start'),
    el('button', { class: 'sd-btn', onclick: () => { Object.assign(S, { spk: 't1', L0: value('src_t1_db'), caseId: 'night', ambient: value('ambient_night_dba'), dLand: value('d_land_db'), dWater: value('d_water_db'), air: value('air_db_km'), forest: value('forest_db_100m'), clearing: value('clearing_m') }); render(); }, text: 'Back to base values' }));
}

// The sound profile: a village speaker on its mast, the clearing, then forest; the level along the path, green
// where it is heard and orange where it is not. Flat ground for now: terrain comes with the DEM in Stage 3.
function profileCard(o, thr, r) {
  const W = 680, H = 300, l = 46, rr = 14, top = 16, mid = 196, bot = 270, max = Math.max(1500, Math.min(4000, r * 1.8, o.clearingM + 1500));
  const X = m => l + (m / max) * (W - l - rr), yMin = 30, yMax = Math.max(S.L0 + 2, 100), Y = v => mid - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (mid - top);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg cv-prof', role: 'img', 'aria-label': `Sound level out of a village into forest: heard to ${Math.round(r)} m` });
  for (let v = 40; v <= yMax; v += 20) { sv('line', { x1: l, x2: W - rr, y1: Y(v), y2: Y(v), class: 'sd-grid' }, s); svText(s, { x: l - 4, y: Y(v) + 4, 'text-anchor': 'end', class: 'sub' }, `${v}`); }
  svText(s, { x: 0, y: 10, class: 'sub' }, 'dB');
  // ground band: clearing, forest, huts, trees, mast
  const g = sv('g', {}, s);
  sv('rect', { x: l, y: bot - 40, width: X(Math.min(o.clearingM, max)) - l, height: 40, class: 'cv-clearing' }, g);
  sv('rect', { x: X(Math.min(o.clearingM, max)), y: bot - 40, width: W - rr - X(Math.min(o.clearingM, max)), height: 40, class: 'cv-forest' }, g);
  for (let m = 40; m < Math.min(o.clearingM, max) - 20; m += 70) sv('path', { d: `M${X(m) - 5},${bot - 2}v-7l5,-5l5,5v7z`, class: 'cv-hut' }, g);
  for (let m = o.clearingM + 25; m < max; m += max / 18) { sv('line', { x1: X(m), x2: X(m), y1: bot - 2, y2: bot - 14, class: 'cv-trunk' }, g); sv('ellipse', { cx: X(m), cy: bot - 24, rx: 7, ry: 12, class: 'cv-tree' }, g); }
  sv('line', { x1: l, x2: l, y1: bot - 2, y2: bot - 34, class: 'cv-mast' }, g);
  sv('path', { d: `M${l},${bot - 36}l9,-5v10z`, class: 'cv-spk' }, g);
  sv('line', { x1: l, x2: W - rr, y1: bot, y2: bot, class: 'sd-axis' }, s);
  for (let m = 0; m <= max; m += max > 2500 ? 500 : 250) svText(s, { x: X(m), y: bot + 14, 'text-anchor': 'middle', class: 'sub' }, m >= 1000 ? `${fmt(m / 1000, m % 1000 ? 2 : 0)} km` : `${m} m`);
  // level along the path, coloured against the threshold
  const pts = Array.from({ length: 220 }, (_, i) => (max * (i + 1)) / 220);
  const seg2 = (pred, cls) => { let d = '', on = false; for (const m of pts) { const v = level(m, o), ok = pred(v); if (ok) { d += `${on ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`; on = true; } else on = false; } sv('path', { d, class: cls }, s); };
  seg2(v => v >= thr, 'cv-heard'); seg2(v => v < thr, 'cv-not');
  sv('line', { x1: l, x2: W - rr, y1: Y(thr), y2: Y(thr), class: 'sd-cap' }, s);
  svText(s, { x: W - rr - 2, y: Y(thr) - 5, 'text-anchor': 'end', class: 'lbl' }, `heard above ${thr} dB`);
  if (r > 0 && r < max) { sv('line', { x1: X(r), x2: X(r), y1: top, y2: bot, class: 'cv-r' }, s); svText(s, { x: X(r) + 4, y: top + 12, class: 'lbl' }, `${fmt(r)} m`); }
  svText(s, { x: X(Math.min(o.clearingM, max)) + 4, y: bot - 44, class: 'sub' }, 'forest starts');
  const hit = sv('rect', { x: l, y: top, width: W - l - rr, height: bot - top, fill: 'transparent' }, s);
  hit.addEventListener('pointermove', ev => { const b = s.getBoundingClientRect(), m = Math.max(0, ((((ev.clientX - b.left) / b.width) * W - l) / (W - l - rr)) * max); const v = level(m, o); showTip(ev, [el('b', { text: `${fmt(m)} m: ${fmt(v, 1)} dB` }), el('div', { class: 'k', text: v >= thr ? 'heard' : `${fmt(thr - v, 1)} dB short` })]); });
  hit.addEventListener('pointerleave', hideTip);
  return chartBlock('cv-profile', 'Sound profile: out of a village, into the forest', el('div', {}, s,
    el('p', { class: 'cv-note' }, `Once the voice leaves the clearing, the forest takes ${S.forest} dB every 100 m. Flat ground and a clean clearing: the real terrain and canopy around Mbandaka are below.`)),
  [['Distance (m)', 'Level (dB)', 'Heard'], ...[50, 100, 200, 300, 400, 500, 750, 1000, 1500].map(m => [String(m), fmt(level(m, o), 1), level(m, o) >= thr ? 'yes' : 'no'])]);
}

// ---------- the real terrain: 12 pilot speakers around Mbandaka, 12 bearings each (analysis/scripts/pilot_profiles.py) ----------
// The geometry (ground, canopy, metres of the path under the canopy, ground in the way) is fixed; the levels are
// recomputed here from the sliders, so the footprint answers to the same settings as the flat model above.
const BAR_DB = PROF.params.barrier_db;
function bearingLevels(b) {
  const L0 = S.L0, D = S.dLand, air = S.air, f = S.forest, r0 = PROF.r0_m;
  return b.forest_path_m.map((fp, i) => { const r = (i + 1) * PROF.step_m; return L0 - D * Math.log2(r / r0) - (air * (r - r0)) / 1000 - (f * fp) / 100 - (b.blocked[i] ? BAR_DB : 0); });
}
function heardTo(lv, thr) { const i = lv.findIndex(v => v < thr); return i < 0 ? PROF.max_m : i * PROF.step_m; }
const median = a => { const b = [...a].sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };

function terrainCard(thr, flatR) {
  const spk = PROF.speakers[S.pSpk], brg = spk.bearings[S.pBrg];
  const heard = spk.bearings.map(b => heardTo(bearingLevels(b), thr));
  const all = PROF.speakers.flatMap(s => s.bearings.map(b => heardTo(bearingLevels(b), thr)));
  const lv = bearingLevels(brg), hb = heard[S.pBrg];
  const pickSpk = el('div', { class: 'sd-num' }, el('div', { class: 'sd-num-h' }, el('span', { text: 'Pilot speaker' }), el('b', { text: `reaches ${fmt(spk.heard_people)} people` })),
    seg(PROF.speakers.map((_, i) => [i, String(i + 1)]), S.pSpk, v => { S.pSpk = v; render(); }, 'Pilot speaker'));
  const pickBrg = el('div', { class: 'sd-num' }, el('div', { class: 'sd-num-h' }, el('span', { text: 'Bearing (or click the compass)' }), el('b', { text: `${brg.deg}°` })),
    seg(spk.bearings.map((b, i) => [i, `${b.deg}`]), S.pBrg, v => { S.pBrg = v; render(); }, 'Bearing'));
  const med = median(all);
  const sum = el('p', { class: 'cv-key' }, `Over the real ground and canopy the ${PROF.speakers.length} pilot speakers are heard to a median of ${fmt(med)} m (${fmt(Math.min(...all))}–${fmt(Math.max(...all))} m over ${all.length} bearings), against ${fmt(flatR)} m on flat ground with a ${S.clearing} m clearing. `,
    med < flatR ? 'Most of these villages sit under or right against the trees, so the forest starts at the speaker; open water and fields carry it further.' : 'Open ground and water around these villages carry the voice further than the flat model.');
  const rows = [['Bearing', 'Heard to (m)', 'Forest along the bearing', 'Ground in the way from (m)'],
    ...spk.bearings.map((b, i) => { const k = b.blocked.indexOf(1); return [`${b.deg}°`, fmt(heard[i]), `${Math.round(b.forest_share * 100)}%`, k < 0 ? 'never' : fmt((k + 1) * PROF.step_m)]; })];
  return chartBlock('cv-terrain', `Real terrain: the ${PROF.pilot.name} pilot`, el('div', {},
    el('div', { class: 'cv-terr-pick' }, pickSpk, pickBrg),
    el('div', { class: 'cv-terr' }, compass(spk, heard, flatR), terrProfile(brg, lv, thr, hb, spk)),
    sum,
    el('p', { class: 'cv-note' }, tag('Sourced', 'baseline'), ` Terrain: Copernicus GLO-30 surface model; canopy: ETH Global Canopy Height 2020 (10 m); villages: GRID3 blocks. Speaker ${S.pSpk + 1} at ${spk.lon.toFixed(3)}°E ${spk.lat.toFixed(3)}°N on a ${spk.mast_m} m mast, listener 1.5 m up. `,
      tag('Modeled proxy', 'proxy'), ` Bare ground = surface model minus canopy height, smoothed over 300 m; where the ground blocks the line the voice loses ${BAR_DB} dB more. The pilot area has ${fmt(PROF.pilot_speakers)} speakers for ${fmt(PROF.pilot_people)} people outside Mbandaka's urban centre (${fmt(PROF.pilot_urban_people)} more inside it, on phones and radio first).`)),
  rows);
}

// The footprint: how far the voice carries on each of the 12 bearings, against the flat model's circle.
function compass(spk, heard, flatR) {
  const W = 260, c = W / 2, R = c - 22, max = PROF.max_m, k = R / max;
  const s = sv('svg', { viewBox: `0 0 ${W} ${W}`, class: 'vsvg cv-compass', role: 'img', 'aria-label': `Footprint of pilot speaker ${S.pSpk + 1}: heard ${fmt(Math.min(...heard))} to ${fmt(Math.max(...heard))} m` });
  for (const m of [500, 1000, 1500, 2000]) { sv('circle', { cx: c, cy: c, r: m * k, class: 'sd-grid', fill: 'none' }, s); svText(s, { x: c + 3, y: c - m * k + 11, class: 'sub' }, m >= 1000 ? `${m / 1000} km` : `${m} m`); }
  sv('circle', { cx: c, cy: c, r: Math.min(flatR, max) * k, class: 'cv-flat' }, s);
  const xy = (deg, m) => [c + Math.sin((deg * Math.PI) / 180) * m * k, c - Math.cos((deg * Math.PI) / 180) * m * k];
  sv('polygon', { points: spk.bearings.map((b, i) => xy(b.deg, heard[i]).map(v => v.toFixed(1)).join(',')).join(' '), class: 'cv-foot' }, s);
  spk.bearings.forEach((b, i) => {
    const [x, y] = xy(b.deg, max), [hx, hy] = xy(b.deg, heard[i]), on = i === S.pBrg;
    sv('line', { x1: c, y1: c, x2: x, y2: y, class: on ? 'cv-spoke is-on' : 'cv-spoke' }, s);
    sv('circle', { cx: hx, cy: hy, r: on ? 5 : 3.2, class: on ? 'cv-hpt is-on' : 'cv-hpt' }, s);
    if (b.deg % 90 === 0) { const [lx, ly] = xy(b.deg, max + 150); svText(s, { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'lbl' }, ['N', 'E', 'S', 'W'][b.deg / 90]); }
    const hit = sv('line', { x1: c, y1: c, x2: x, y2: y, stroke: 'transparent', 'stroke-width': 16, style: 'cursor:pointer' }, s);
    hit.addEventListener('click', () => { S.pBrg = i; hideTip(); render(); });
    hit.addEventListener('pointermove', ev => showTip(ev, [el('b', { text: `${b.deg}°: heard to ${fmt(heard[i])} m` }), el('div', { class: 'k', text: `canopy over 3 m on ${Math.round(b.forest_share * 100)}% of the bearing` })]));
    hit.addEventListener('pointerleave', hideTip);
  });
  sv('circle', { cx: c, cy: c, r: 4, class: 'cv-hub' }, s);
  return el('div', { class: 'cv-compass-w' }, s, el('div', { class: 'sd-legend' },
    el('span', {}, el('i', { style: 'background:var(--good)' }), 'heard, real terrain'),
    el('span', {}, el('i', { class: 'cv-lg-flat' }), `flat model ${fmt(flatR)} m`)));
}

// One bearing: the ground, the canopy and the speaker on its mast (lower panel), the level along it (upper panel).
function terrProfile(b, lv, thr, hb, spk) {
  const W = 520, H = 300, l = 40, rr = 10, top = 12, mid = 150, gTop = 176, bot = 270, max = PROF.max_m, n = lv.length;
  const X = m => l + (m / max) * (W - l - rr);
  const yMin = 30, yMax = Math.max(S.L0 - 10, 100), Y = v => mid - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (mid - top);
  const gr = b.ground_m, tops = gr.map((g, i) => g + b.canopy_m[i]);
  const zLo = Math.min(0, ...gr) - 2, zHi = Math.max(spk.mast_m, ...tops) + 2, Z = z => bot - ((z - zLo) / (zHi - zLo)) * (bot - gTop);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg cv-prof', role: 'img', 'aria-label': `Bearing ${b.deg}°: heard to ${fmt(hb)} m over the real ground and canopy` });
  for (let v = 40; v <= yMax; v += 20) { sv('line', { x1: l, x2: W - rr, y1: Y(v), y2: Y(v), class: 'sd-grid' }, s); svText(s, { x: l - 4, y: Y(v) + 4, 'text-anchor': 'end', class: 'sub' }, `${v}`); }
  svText(s, { x: 0, y: 10, class: 'sub' }, 'dB');
  const dist = i => (i + 1) * PROF.step_m;
  // canopy (ground to canopy top), the ground line, the mast and the straight path to the edge of hearing
  let cp = `M${X(0)},${Z(0)}`;
  tops.forEach((t, i) => { cp += `L${X(dist(i)).toFixed(1)},${Z(t).toFixed(1)}`; });
  for (let i = n - 1; i >= 0; i--) cp += `L${X(dist(i)).toFixed(1)},${Z(gr[i]).toFixed(1)}`;
  sv('path', { d: cp + 'Z', class: 'cv-canopy' }, s);
  sv('path', { d: `M${X(0)},${Z(0)}` + gr.map((g, i) => `L${X(dist(i)).toFixed(1)},${Z(g).toFixed(1)}`).join(''), class: 'cv-ground' }, s);
  sv('line', { x1: X(0), x2: X(0), y1: Z(0), y2: Z(spk.mast_m), class: 'cv-mast' }, s);
  sv('path', { d: `M${X(0)},${Z(spk.mast_m) - 2}l9,-5v10z`, class: 'cv-spk' }, s);
  if (hb > 0) { const i = Math.min(n - 1, Math.round(hb / PROF.step_m) - 1); sv('line', { x1: X(0), y1: Z(spk.mast_m), x2: X(hb), y2: Z(gr[i] + 1.5), class: 'cv-path' }, s); }
  svText(s, { x: W - rr, y: gTop - 6, 'text-anchor': 'end', class: 'sub' }, `ground and canopy, ${fmt(zLo, 0)} to ${fmt(zHi, 0)} m from the speaker's ground`);
  sv('line', { x1: l, x2: W - rr, y1: bot, y2: bot, class: 'sd-axis' }, s);
  for (let m = 0; m <= max; m += 500) svText(s, { x: X(m), y: bot + 14, 'text-anchor': 'middle', class: 'sub' }, m >= 1000 ? `${m / 1000} km` : `${m} m`);
  // the level along the bearing, green where it is heard
  const line = (pred, cls) => { let d = '', on = false; lv.forEach((v, i) => { if (pred(v)) { d += `${on ? 'L' : 'M'}${X(dist(i)).toFixed(1)},${Y(v).toFixed(1)}`; on = true; } else on = false; }); sv('path', { d, class: cls }, s); };
  line(v => v >= thr, 'cv-heard'); line(v => v < thr, 'cv-not'); // a ground shadow can drop the level below and let it come back further out
  sv('line', { x1: l, x2: W - rr, y1: Y(thr), y2: Y(thr), class: 'sd-cap' }, s);
  svText(s, { x: W - rr - 2, y: Y(thr) - 5, 'text-anchor': 'end', class: 'lbl' }, `heard above ${thr} dB`);
  if (hb > 0 && hb < max) { sv('line', { x1: X(hb), x2: X(hb), y1: top, y2: bot, class: 'cv-r' }, s); svText(s, { x: X(hb) + 4, y: top + 12, class: 'lbl' }, `${fmt(hb)} m`); }
  const hit = sv('rect', { x: l, y: top, width: W - l - rr, height: bot - top, fill: 'transparent' }, s);
  hit.addEventListener('pointermove', ev => {
    const bb = s.getBoundingClientRect(), m = ((((ev.clientX - bb.left) / bb.width) * W - l) / (W - l - rr)) * max, i = Math.max(0, Math.min(n - 1, Math.round(m / PROF.step_m) - 1));
    showTip(ev, [el('b', { text: `${fmt(dist(i))} m: ${fmt(lv[i], 1)} dB` }), el('div', { class: 'k', text: lv[i] >= thr ? 'heard' : `${fmt(thr - lv[i], 1)} dB short` }),
      el('div', { class: 'k', text: `canopy ${b.canopy_m[i]} m; ${fmt(b.forest_path_m[i])} m of the path under it${b.blocked[i] ? '; ground in the way' : ''}` })]);
  });
  hit.addEventListener('pointerleave', hideTip);
  return s;
}

function curveCard(P, thr, R) {
  const W = 680, H = 250, l = 46, rr = 14, t = 14, b = 30, max = 6000;
  const X = m => l + (Math.log10(Math.max(m, 30)) - Math.log10(30)) / (Math.log10(max) - Math.log10(30)) * (W - l - rr), yMin = 20, yMax = Math.max(S.L0 + 2, 100), Y = v => H - b - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (H - t - b);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vsvg', role: 'img', 'aria-label': 'Sound level against distance for three paths' });
  for (let v = 40; v <= yMax; v += 20) { sv('line', { x1: l, x2: W - rr, y1: Y(v), y2: Y(v), class: 'sd-grid' }, s); svText(s, { x: l - 4, y: Y(v) + 4, 'text-anchor': 'end', class: 'sub' }, `${v}`); }
  for (const m of [30, 100, 300, 1000, 3000, 6000]) svText(s, { x: X(m), y: H - 12, 'text-anchor': 'middle', class: 'sub' }, m >= 1000 ? `${m / 1000} km` : `${m} m`);
  svText(s, { x: (l + W) / 2, y: H - 1, 'text-anchor': 'middle', class: 'sub' }, 'distance (log scale)');
  const cols = { open: '--s1', water: '--river', village: '--s6' };
  const pts = Array.from({ length: 160 }, (_, i) => 30 * (max / 30) ** (i / 159));
  for (const [k, o] of Object.entries(P)) {
    sv('path', { d: `M${pts.map(m => `${X(m).toFixed(1)},${Y(level(m, o)).toFixed(1)}`).join('L')}`, fill: 'none', stroke: `var(${cols[k]})`, 'stroke-width': k === 'village' ? 3 : 2 }, s);
    if (R[k] > 0) sv('circle', { cx: X(R[k]), cy: Y(thr), r: 4.5, fill: `var(${cols[k]})`, stroke: 'var(--bg)', 'stroke-width': 1.5 }, s);
  }
  for (const [id, c] of Object.entries(CASES)) {
    const tv = value(c.ambient) + value('margin_db') + (c.building ? value(c.building) : 0);
    sv('line', { x1: l, x2: W - rr, y1: Y(tv), y2: Y(tv), class: id === S.caseId ? 'sd-cap' : 'cv-thr' }, s);
    svText(s, { x: l + 4, y: Y(tv) - 4, class: 'sub' }, `${c.label.split(' (')[0]} ${tv} dB`);
  }
  const legend = el('div', { class: 'sd-legend' }, Object.entries(P).map(([k, o]) => el('span', {}, el('i', { style: `background:var(${cols[k]})` }), `${o.label}: ${fmt(R[k])} m`)));
  return chartBlock('cv-curve', 'Level against distance, three paths', el('div', {}, s, legend),
    [['Distance (m)', ...Object.values(P).map(o => o.label)], ...[100, 300, 500, 1000, 2000, 4000].map(m => [String(m), ...Object.values(P).map(o => fmt(level(m, o), 1))])]);
}

function resultsCard(R, thr) {
  const ppl = value('people_per_village');
  const big = (v, label) => el('div', { class: 'cv-res' }, el('b', { text: v >= 1000 ? `${fmt(v / 1000, 2)} km` : `${fmt(v)} m` }), el('span', { text: label }));
  return card('What one speaker covers',
    el('p', { class: 'cv-note', text: `${CASES[S.caseId].label}: heard above ${thr} dB (${S.ambient} dBA background + ${value('margin_db')} dB${S.caseId === 'indoor' ? ` + ${value('building_open_db')} dB through the walls` : ''}).` }),
    big(R.village, `out of a ${S.clearing} m clearing into forest (${fmt(areaKm2(R.village), 2)} km²)`),
    big(R.open, 'over open ground'),
    big(R.water, 'along the river'),
    el('p', { class: 'cv-key' }, R.village > S.clearing
      ? `The voice reaches ${fmt(R.village - S.clearing)} m into the forest: enough for one village of about ${ppl} people, not the hamlets around it.`
      : `The voice does not fill the ${S.clearing} m clearing: a bigger village needs more than one speaker, or a louder one.`),
    el('p', { class: 'cv-note' }, tag('Assumption', 'assume'), ' Background noise, forest loss and speaker level all need field measurement. Pilot plan: a calibrated sound check on 12 bearings at 100, 300, 600 and 1,000 m, day and night.'));
}

function checkCard() {
  const rows = briefTable();
  return chartBlock('cv-check', 'Check: the brief\'s table, recomputed', el('table', { class: 'vtable cv-check' },
    el('thead', {}, el('tr', {}, el('th', { text: 'dB' }), rows[0].km.map(c => el('th', { text: c.label.replace('Clearing → forest ', 'forest ') })))),
    el('tbody', {}, rows.map(r => el('tr', {}, el('th', { scope: 'row', text: String(r.t) }), r.km.map(c => el('td', { text: fmt(c.km, 2) })))))),
  [['dB', ...rows[0].km.map(c => c.label)], ...rows.map(r => [String(r.t), ...r.km.map(c => fmt(c.km, 2))])],
  [el('span', { class: 'cv-note', text: '124 dB tower, 10 dB per doubling, 5 dB/km air, 300 m clearing; km' })]);
}
