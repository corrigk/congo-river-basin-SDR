// Crew rounds (Design tab): a year of one major hub's crews, day by day, on the hub design and the settings of
// "What's at a station". Three showcase major hubs (river, road, remote) from the default design, with the real routes
// their crews take on the SRR travel model (analysis/scripts/rounds_routes.py).
//
// The schedule, simulated here (deterministic, seeded):
//   teams        the crews the hub needs (as the station design) x people per crew / rangers per team
//   duty         each team works a 30-day rotation, on for its share of the field days (teams staggered)
//   routine      stays at each minor hub and village stay, spread through the year: enough stays for its speakers'
//                routine visits (halved with caretakers); day rounds for speakers within a day trip
//   repairs      speaker faults arrive at random (repair visits a speaker a year); a fault waits up to the wait
//                allowed (7 / 21 / 45 days) for a trip to its place, otherwise it gets its own trip (1 working day)
//   load         the field days all the jobs need over the teams' duty days (over 100%: they cannot all be done)
//   assignment   jobs in date order to the team that can start soonest inside one of its duty blocks
// Time runs in field days: each calendar day the crews move from 07:00 for the field-day hours, then rest.
import { el, seg, fmt, tag, chartBlock, showTip, hideTip } from '../v2/ui.js';
import { evaluateKit, DEFAULT_KIT, SHARED, SEASONS, zoneOf, seasonMult } from './stationkit.js';

const YEAR = 365, CYCLE = 30, MONTH = YEAR / 12;
const monthOf = d => Math.min(11, Math.max(0, Math.floor((((d % YEAR) + YEAR) % YEAR) / MONTH)));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const KM = (a, b) => Math.hypot((b[0] - a[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110.57);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function poisson(lam, r) { let k = 0, p = 1; const L = Math.exp(-lam); do { k++; p *= r(); } while (p > L); return k - 1; }

// ----- the simulated year for one major hub -----
export function simulate(M, kit, P) {
  const r = rng(7 + Math.round(M.lon * 100));
  const crewsHere = Math.min(kit.crews, Math.max(1, Math.ceil(M.speakers / (P.X / kit.crews)))) + V.crewsAdd;
  const teams = Math.max(1, Math.round((crewsHere * kit.people) / kit.team)); // a spare ranger covers another's days off
  const onDays = Math.max(4, Math.round((CYCLE * kit.days) / YEAR));
  const T = Array.from({ length: teams }, (_, j) => ({ id: j, free: 0, off: Math.floor((j * CYCLE) / teams), segs: [] }));
  const onDuty = (tm, d) => ((((Math.floor(d) + tm.off) % CYCLE) + CYCLE) % CYCLE) < onDays;
  const blockEnd = (tm, d) => { let e = Math.floor(d); while (onDuty(tm, e)) e++; return e; };
  const vRoutine = kit.routine * (kit.caretaker ? 0.5 : 1), fr = kit.caretaker ? 0.5 : 1; // caretakers: half the routine visits, half the faults (simple repairs)
  const jobs = [], zone = zoneOf(M.lat);
  // seasons: each route's minutes by mode, slowed by the month's rains (roads, paths) or low water (boats)
  const modeMin = p => { const o = { boat: 0, road: 0, foot: 0 }; for (let i = 1; i < p.route.length; i++) o[p.route[i][2]] += p.route[i][3] - p.route[i - 1][3]; return o; };
  const mult = (p, k) => { const mm = p._mm ||= modeMin(p), tot = mm.boat + mm.road + mm.foot || 1; return kit.seasons ? Object.entries(mm).reduce((a, [m, v]) => a + (v / tot) * seasonMult(zone, k, m), 0) : 1; };
  const travelAt = (p, d) => ((p.minutes / 60) * mult(p, monthOf(d))) / kit.dayH;
  const durAt = (j, d) => (j.kind === 'day' ? 1 : 2 * travelAt(M.places[j.pi], d) + j.work);
  M.places.forEach((p, pi) => {
    const tH = p.minutes / 60;
    if (p.kind === 'day') {
      const perDay = Math.max(1, Math.min(kit.perRound, Math.floor((kit.dayH - 2 * tH) / kit.onsite)));
      const n = Math.ceil((p.speakers * kit.routine) / perDay);
      for (let k = 0; k < n; k++) jobs.push({ pi, kind: 'day', day: ((k + r()) * YEAR) / n });
      for (let k = poisson(p.speakers * kit.repair * fr, r); k > 0; k--) { const d = r() * YEAR; jobs.push({ pi, kind: 'day', repair: true, fault: d, day: d }); }
      return;
    }
    const perStay = (kit.workDays * kit.dayH) / (kit.onsite + (2 * (p.local_min / 60)) / kit.perRound);
    const n = vRoutine > 0 ? Math.ceil((p.speakers * vRoutine) / perStay) : 0, phase = r();
    const mine = [];
    // routine stays spread through the year, or (planned) through this route's easiest months
    const months = kit.seasons && kit.planSeasons ? [...Array(12).keys()].sort((a, b) => mult(p, a) - mult(p, b)).slice(0, SEASONS.plan_months).sort((a, b) => a - b) : null;
    for (let k = 0; k < n; k++) {
      const u = ((k + phase) / n) % 1, d = months ? (months[Math.floor(u * months.length)] + ((u * months.length) % 1)) * MONTH : u * YEAR;
      const j = { pi, kind: 'stay', day: d, work: kit.workDays }; mine.push(j); jobs.push(j);
    }
    // faults: picked up by any trip to this place that starts within the wait allowed, else a repair trip of its own
    const faults = Array.from({ length: poisson(p.speakers * kit.repair * fr, r) }, () => r() * YEAR).sort((a, b) => a - b);
    for (const d of faults) {
      const j = mine.find(x => x.day >= d && x.day - d <= kit.faultWait);
      if (j) (j.faults ||= []).push(d);
      else { const nj = { pi, kind: 'stay', repair: true, day: d + kit.faultWait, faults: [d], work: 1 }; mine.push(nj); jobs.push(nj); }
    }
  });
  jobs.sort((a, b) => a.day - b.day);
  const stats = { stays: 0, repairTrips: 0, dayRounds: 0, visits: 0, nights: 0, waits: [], km: { boat: 0, road: 0, foot: 0 }, unfit: 0, busy: 0, demand: 0, travel: 0, travelDry: 0 };
  for (const j of jobs) {
    let best = null;
    for (const tm of T) {
      let s = Math.max(j.day, tm.free);
      for (let guard = 0; guard < 60; guard++) {
        if (!onDuty(tm, s)) { s = Math.floor(s) + 1; continue; }
        const dur = durAt(j, s);
        if (s + dur <= blockEnd(tm, s) + 0.001 || dur > onDays) break;
        s = blockEnd(tm, s); // try the next block
      }
      if (!best || s < best.s) best = { tm, s };
    }
    const { tm, s } = best;
    if (s >= YEAR) { stats.unfit++; stats.demand += durAt(j, j.day); continue; }
    const p = M.places[j.pi];
    j.travel = j.kind === 'day' ? 0 : travelAt(p, s); j.dur = durAt(j, s);
    stats.travel += 2 * j.travel; stats.travelDry += j.kind === 'day' ? 0 : (2 * p.minutes) / 60 / kit.dayH;
    const e = s + j.dur;
    if (j.kind === 'day') {
      tm.segs.push({ kind: j.repair ? 'repair' : 'day', s, e, pi: j.pi });
      stats.dayRounds++; stats.visits += j.repair ? 1 : Math.min(kit.perRound, p.speakers);
      if (j.repair) stats.waits.push(s - j.fault);
    } else {
      tm.segs.push({ kind: 'out', s, e: s + j.travel, pi: j.pi }, { kind: j.repair ? 'repair' : 'work', s: s + j.travel, e: s + j.travel + j.work, pi: j.pi }, { kind: 'back', s: s + j.travel + j.work, e, pi: j.pi });
      j.repair ? stats.repairTrips++ : stats.stays++;
      stats.nights += Math.ceil(e) - Math.floor(s);
      stats.visits += j.repair ? 1 : Math.round(Math.min(p.speakers, (kit.workDays * kit.dayH) / (kit.onsite + (2 * (p.local_min / 60)) / kit.perRound)));
      for (const f of j.faults || []) stats.waits.push(s + j.travel - f);
    }
    stats.busy += e - s; stats.demand += j.dur;
    for (let i = 1; i < p.route.length; i++) stats.km[p.route[i][2]] += 2 * KM(p.route[i - 1], p.route[i]);
    tm.free = e;
  }
  stats.nightsPerRanger = stats.nights / teams;
  stats.seasonPct = stats.travelDry ? (stats.travel / stats.travelDry - 1) * 100 : 0; // extra travel time from the seasons
  stats.busyShare = stats.demand / (teams * YEAR * (onDays / CYCLE)); // field days the jobs need / duty days
  stats.fuelL = (stats.km.boat * 0.6 + stats.km.road * 0.035) * kit.motorShare;
  return { teams: T, crewsHere, onDays, stats, jobs: jobs.length, zone };
}

// Field-day position of a calendar time: crews move from 07:00 for dayH hours.
const fieldT = (tau, dayH) => { const d = Math.floor(tau), h = (tau - d) * 24; return d + Math.max(0, Math.min(1, (h - 7) / dayH)); };
// A point a share u of the way along a route (by minutes).
function along(route, u) {
  const tot = route.at(-1)[3] || 1, t = u * tot;
  for (let i = 1; i < route.length; i++) if (route[i][3] >= t) { const a = route[i - 1], b = route[i], f = (t - a[3]) / Math.max(1e-6, b[3] - a[3]); return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), b[2]]; }
  return [route.at(-1)[0], route.at(-1)[1], route.at(-1)[2]];
}
function teamAt(tm, M, tau, dayH) {
  const F = fieldT(tau, dayH), sg = tm.segs.find(x => F >= x.s && F < x.e);
  if (!sg) return { lon: M.lon, lat: M.lat, kind: 'home' };
  const p = M.places[sg.pi], u = (F - sg.s) / (sg.e - sg.s);
  if (sg.kind === 'out') { const [lon, lat, mode] = along(p.route, u); return { lon, lat, kind: 'travel', mode, p }; }
  if (sg.kind === 'back') { const [lon, lat, mode] = along(p.route, 1 - u); return { lon, lat, kind: 'travel', mode, p }; }
  if (sg.kind === 'day' || (sg.kind === 'repair' && p.kind === 'day')) { const v = F - Math.floor(F); const [lon, lat, mode] = along(p.route, v < 0.5 ? v * 2 : 2 - v * 2); return { lon, lat, kind: 'day', mode, p }; }
  // working from the minor hub: out to a local speaker cell and back each field day
  const loc = p.local.length ? p.local[Math.floor(F) % p.local.length] : null, v = F - Math.floor(F), w = v < 0.5 ? v * 2 : 2 - v * 2;
  return loc ? { lon: p.lon + w * (loc[0] - p.lon), lat: p.lat + w * (loc[1] - p.lat), kind: sg.kind, p } : { lon: p.lon, lat: p.lat, kind: sg.kind, p };
}

// ----- the page -----
const V = { major: 0, tau: 0, play: false, speed: 7, window: 'month', crewsAdd: 0 };
let timer = 0, last = 0;

export function roundsStep({ R, geo, cov, render }) {
  clearInterval(timer);
  const kit = (SHARED.kit ||= DEFAULT_KIT()), P = evaluateKit({ ...kit, hubs: true }, cov);
  const M = R.majors[V.major], sim = simulate(M, kit, P);
  const cv = el('canvas', { class: 'rd-map', role: 'img', 'aria-label': `Map of the ${M.type} major hub, its ${M.places.length} places and the routes its crews take` });
  const gantt = el('canvas', { class: 'rd-gantt', role: 'img', 'aria-label': `Calendar of ${sim.teams.length} teams over the ${V.window}` });
  const clock = el('b', { class: 'rd-clock' }), live = el('div', { class: 'rd-live' });
  const slider = el('input', { type: 'range', min: 0, max: YEAR - 0.01, step: 0.05, value: V.tau, 'aria-label': 'Day of the year', oninput: e => { V.tau = +e.target.value; draw(); } });
  const playBtn = el('button', { class: 'sd-btn', onclick: () => { V.play = !V.play; playBtn.textContent = V.play ? 'Pause' : 'Play'; if (V.play) start(); } , text: V.play ? 'Pause' : 'Play' });
  const s = sim.stats, waits = s.waits.sort((a, b) => a - b), med = waits.length ? waits[Math.floor(waits.length / 2)] : 0;

  // map projection fitted to the hub's places
  const pts = [[M.lon, M.lat], ...M.places.flatMap(p => [...p.route.map(q => [q[0], q[1]]), ...p.local.map(q => [q[0], q[1]])])];
  const lo0 = Math.min(...pts.map(p => p[0])), lo1 = Math.max(...pts.map(p => p[0])), la0 = Math.min(...pts.map(p => p[1])), la1 = Math.max(...pts.map(p => p[1]));
  function proj(W, H) {
    const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180), w = (lo1 - lo0) * kx || 0.5, h = la1 - la0 || 0.5, pad = 26, sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
    const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
    return (lon, lat) => [ox + (lon - lo0) * kx * sc, oy + (la1 - lat) * sc];
  }
  function drawMap() {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth || 600, H = cv.clientHeight || 420;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const px = proj(W, H);
    const lines = (fc, col, lw) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); for (const f of fc.features) { const g = f.geometry, L = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []; for (const l of L) l.forEach(([lon, lat], i) => { const [x, y] = px(lon, lat); i ? c.lineTo(x, y) : c.moveTo(x, y); }); } c.stroke(); };
    c.fillStyle = css('--card-3'); c.fillRect(0, 0, W, H);
    lines(geo.roads, css('--line-2'), 1); lines(geo.rivers, css('--river'), 1.6); lines(geo.basin, css('--accent'), 1.2);
    const MODE_COL = { boat: css('--river'), road: css('--muted'), foot: css('--good') };
    for (const p of M.places) {
      for (let i = 1; i < p.route.length; i++) {
        const [a, b] = [px(p.route[i - 1][0], p.route[i - 1][1]), px(p.route[i][0], p.route[i][1])];
        c.strokeStyle = MODE_COL[p.route[i][2]]; c.lineWidth = 1.4; c.setLineDash(p.route[i][2] === 'foot' ? [3, 3] : []); c.globalAlpha = 0.7;
        c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
      }
      c.setLineDash([]); c.globalAlpha = 1;
      for (const q of p.local) { const [x, y] = px(q[0], q[1]); c.fillStyle = css('--gold'); c.globalAlpha = 0.55; c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill(); }
      c.globalAlpha = 1;
      const [x, y] = px(p.lon, p.lat);
      if (p.kind === 'minor') { c.strokeStyle = css('--s5'); c.lineWidth = 2; c.strokeRect(x - 4.5, y - 4.5, 9, 9); }
      else if (p.kind === 'village') { c.fillStyle = css('--s5'); c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
      else { c.fillStyle = css('--gold'); c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); }
    }
    const [hx, hy] = px(M.lon, M.lat); c.fillStyle = css('--text'); c.fillRect(hx - 6, hy - 6, 12, 12); c.strokeStyle = css('--bg'); c.lineWidth = 1.5; c.strokeRect(hx - 6, hy - 6, 12, 12);
    // the teams
    const states = sim.teams.map(tm => teamAt(tm, M, V.tau, kit.dayH));
    states.forEach((st, j) => {
      const [x, y] = px(st.lon, st.lat), off = st.kind === 'home' ? [(j % 4) * 9 - 13, -16 - Math.floor(j / 4) * 9] : [0, 0];
      c.fillStyle = st.kind === 'home' ? css('--muted') : css('--accent'); c.strokeStyle = css('--bg'); c.lineWidth = 1.5;
      c.beginPath(); c.arc(x + off[0], y + off[1], 6.5, 0, 7); c.fill(); c.stroke();
      c.fillStyle = css('--bg'); c.font = '700 8.5px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(j + 1), x + off[0], y + off[1] + 0.5);
    });
    return states;
  }
  const COL = { out: '--muted', back: '--muted', work: '--s5', repair: '--critical', day: '--gold' };
  function drawGantt() {
    const dpr = devicePixelRatio || 1, W = gantt.clientWidth || 600, rowH = 15, top = 42, H = top + sim.teams.length * rowH + 6;
    gantt.style.height = `${H}px`;
    if (gantt.width !== Math.round(W * dpr) || gantt.height !== Math.round(H * dpr)) { gantt.width = Math.round(W * dpr); gantt.height = Math.round(H * dpr); }
    const c = gantt.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const span = V.window === 'week' ? 7 : V.window === 'month' ? 30 : YEAR, d0 = V.window === 'year' ? 0 : Math.max(0, Math.min(YEAR - span, Math.floor(V.tau / span) * span));
    const l = 64, X = d => l + ((d - d0) / span) * (W - l - 6);
    c.font = '10px system-ui'; c.fillStyle = css('--muted'); c.textBaseline = 'middle';
    const tick = span === YEAR ? 30.4 : span === 30 ? 7 : 1;
    // the season strips: rains (blue) and low water (gold), deeper for more
    const Z = SEASONS.zones[sim.zone];
    c.textAlign = 'right'; c.fillStyle = css('--muted'); c.fillText('Rains', l - 6, 21); c.fillText('Low water', l - 6, 32);
    for (let d = Math.floor(d0); d < d0 + span; d += span === YEAR ? 1 : 0.5) {
      const k = monthOf(d), x0 = X(d), x1 = X(d + (span === YEAR ? 1 : 0.5));
      c.globalAlpha = 0.15 + 0.6 * Z.wet[k]; c.fillStyle = css('--river'); if (Z.wet[k] > 0) c.fillRect(x0, 17, x1 - x0 + 0.5, 8);
      c.globalAlpha = 0.15 + 0.6 * Z.low[k]; c.fillStyle = css('--gold'); if (Z.low[k] > 0) c.fillRect(x0, 28, x1 - x0 + 0.5, 8);
    }
    c.globalAlpha = 1;
    for (let d = d0; d <= d0 + span + 0.01; d += tick) { c.strokeStyle = css('--line'); c.lineWidth = 1; c.beginPath(); c.moveTo(X(d), top - 2); c.lineTo(X(d), H - 4); c.stroke(); if (d < d0 + span - 0.5) { c.textAlign = 'left'; c.fillText(span === YEAR ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.round(d / 30.4) % 12] : `day ${Math.floor(d) + 1}`, X(d) + 2, 8); } }
    sim.teams.forEach((tm, j) => {
      const y = top + j * rowH; c.textAlign = 'right'; c.fillStyle = css('--muted'); c.fillText(`Team ${j + 1}`, l - 6, y + rowH / 2 - 1);
      for (let d = Math.floor(d0); d < d0 + span; d++) if (!(((d + tm.off) % CYCLE) < sim.onDays)) { c.fillStyle = css('--line'); c.globalAlpha = 0.5; c.fillRect(X(d), y + 2, X(d + 1) - X(d), rowH - 5); c.globalAlpha = 1; }
      for (const sg of tm.segs) { if (sg.e < d0 || sg.s > d0 + span) continue; c.fillStyle = css(COL[sg.kind]); c.fillRect(X(Math.max(d0, sg.s)), y + 2, Math.max(1, X(Math.min(d0 + span, sg.e)) - X(Math.max(d0, sg.s))), rowH - 5); }
    });
    c.strokeStyle = css('--text'); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(V.tau), 13); c.lineTo(X(V.tau), H - 2); c.stroke();
  }
  function draw() {
    const states = drawMap(); drawGantt();
    const d = Math.floor(V.tau), h = Math.floor((V.tau - d) * 24), date = new Date(Date.UTC(2041, 0, 1 + d));
    clock.textContent = `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${String(h).padStart(2, '0')}:00`;
    slider.value = V.tau;
    const Z = SEASONS.zones[sim.zone], k = monthOf(V.tau);
    const seasonNow = !kit.seasons ? 'seasons off' : `${Z.wet[k] >= 0.6 ? 'rainy season' : Z.wet[k] >= 0.3 ? 'some rain' : 'dry season'}${Z.low[k] >= 0.5 ? ', rivers low' : ''}: roads at ${Math.round(100 / seasonMult(sim.zone, k, 'road'))}%, paths ${Math.round(100 / seasonMult(sim.zone, k, 'foot'))}%, boats ${Math.round(100 / seasonMult(sim.zone, k, 'boat'))}% of dry speed`;
    live.replaceChildren(el('div', { class: 'rd-season' }, el('b', { text: SEASONS.zones[sim.zone].label }), el('span', { text: seasonNow })), ...states.map((st, j) => el('div', {}, el('b', { text: `Team ${j + 1}` }), el('span', { text:
      st.kind === 'home' ? 'at the major hub' : st.kind === 'travel' ? `on the way (${st.mode === 'boat' ? 'boat' : st.mode === 'road' ? 'motorbike' : 'on foot'}) · ${st.p.kind === 'minor' ? 'minor hub' : st.p.kind === 'village' ? 'village stay' : 'day trip'}`
        : st.kind === 'day' ? 'day round to nearby speakers' : st.kind === 'repair' ? 'repairing a speaker' : `working from a ${st.p.kind === 'minor' ? 'minor hub' : 'village stay'} (${st.p.speakers} speakers)` }))));
  }
  function start() {
    clearInterval(timer); last = performance.now();
    timer = setInterval(() => {
      if (!cv.isConnected) { clearInterval(timer); return; }
      if (!V.play) return;
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      V.tau = (V.tau + dt * V.speed) % YEAR; draw();
    }, 50);
  }
  cv.addEventListener('pointermove', ev => {
    const b = cv.getBoundingClientRect(), px = proj(b.width, b.height), mx = ev.clientX - b.left, my = ev.clientY - b.top;
    const hit = M.places.find(p => { const [x, y] = px(p.lon, p.lat); return Math.hypot(x - mx, y - my) < 8; });
    if (!hit) { const [x, y] = px(M.lon, M.lat); if (Math.hypot(x - mx, y - my) < 9) showTip(ev, [el('b', { text: `Major hub · ${M.type} access` }), el('div', { text: `${fmt(M.speakers)} speakers · ${sim.crewsHere} crew${sim.crewsHere > 1 ? 's' : ''}, ${sim.teams.length} teams of ${kit.team}` })]); else hideTip(); return; }
    showTip(ev, [el('b', { text: hit.kind === 'minor' ? 'Minor hub' : hit.kind === 'village' ? 'Village stay' : 'Day-trip area' }), el('div', { text: `${fmt(hit.speakers)} speakers · ${fmt(hit.minutes / 60, 1)} h from the major hub` }),
      el('div', { class: 'k', text: [...new Set(hit.route.slice(1).map(q => q[2]))].map(m => (m === 'boat' ? 'by boat' : m === 'road' ? 'by road' : 'on foot')).join(', ') })]);
  });
  cv.addEventListener('pointerleave', hideTip);

  const pickMajor = seg(R.majors.map((m, i) => [i, `${m.type[0].toUpperCase()}${m.type.slice(1)} hub`]), V.major, v => { V.major = v; V.tau = 0; render(); }, 'Major hub');
  const pickWin = seg([['week', 'Week'], ['month', 'Month'], ['year', 'Year']], V.window, v => { V.window = v; render(); }, 'Calendar window');
  const pickSpeed = seg([[1, '1 day/s'], [7, '1 week/s'], [30, '1 month/s']], V.speed, v => { V.speed = v; render(); }, 'Speed');
  const labelled = (label, node) => el('div', { class: 'rd-opt' }, el('span', { text: label }), node);
  const pickWait = labelled('A fault waits for a trip up to', seg([[7, '7 days'], [21, '21 days'], [45, '45 days']], kit.faultWait, v => { kit.faultWait = v; render(); }, 'Longest wait before a repair trip'));
  const pickCrews = labelled('Crews here', seg([[0, `${sim.crewsHere - V.crewsAdd} (design)`], [1, '+1'], [2, '+2']], V.crewsAdd, v => { V.crewsAdd = v; render(); }, 'Extra crews at this hub'));
  const over = s.busyShare > 1;
  const pickSeason = labelled('Seasons', seg([['off', 'Off'], ['on', 'On'], ['plan', 'On, planned']], !kit.seasons ? 'off' : kit.planSeasons ? 'plan' : 'on', v => { kit.seasons = v !== 'off'; kit.planSeasons = v === 'plan'; render(); }, 'Seasons'));
  const kpi = (b, t) => el('div', {}, el('b', { text: b }), el('span', { text: t }));
  const legend = el('div', { class: 'sd-legend' }, [['--text', 'Major hub'], ['--s5', 'Minor hub / village stay'], ['--gold', 'Speakers worked'], ['--river', 'By boat'], ['--muted', 'By road'], ['--good', 'On foot (dashed)'], ['--accent', 'A team (number)']]
    .map(([c, t]) => el('span', {}, el('i', { style: `background:var(${c})` }), t)));
  const glegend = el('div', { class: 'sd-legend' }, [['--muted', 'Travelling'], ['--s5', 'Working from a minor hub or village'], ['--gold', 'Day round'], ['--critical', 'Repair trip'], ['--line', 'Off duty']]
    .map(([c, t]) => el('span', {}, el('i', { style: `background:var(${c})` }), t)), el('span', {}, el('i', { style: 'background:var(--river);opacity:.6' }), 'Rains'), el('span', {}, el('i', { style: 'background:var(--gold);opacity:.6' }), 'Low water'));
  const node = el('div', { class: 'rd' },
    el('div', { class: 'rd-ctl' }, pickMajor, playBtn, pickSpeed, clock, slider),
    el('div', { class: 'rd-ctl' }, pickCrews, pickWait, pickSeason),
    el('div', { class: 'rd-grid' },
      el('div', { class: 'rd-left' }, cv, legend, el('div', { class: 'rd-gwrap' }, el('div', { class: 'rd-gh' }, el('b', { text: 'Who is where' }), pickWin), gantt, glegend)),
      el('div', { class: 'rd-side' },
        el('div', { class: 'co-spec rd-kpi' },
          kpi(`${sim.teams.length}`, `teams of ${kit.team} (${sim.crewsHere} crew${sim.crewsHere > 1 ? 's' : ''} of ${kit.people})`), kpi(fmt(M.speakers), 'speakers this hub looks after'),
          kpi(fmt(s.stays), `stays a year at ${M.places.filter(p => p.kind !== 'day').length} minor hubs and villages`), kpi(fmt(s.repairTrips), 'extra trips for repairs'),
          kpi(fmt(s.nightsPerRanger), 'nights away per ranger a year'), kpi(`${fmt(med, 1)} d`, 'median wait for a repair'),
          kpi(`${fmt(s.km.boat + s.km.road)} km`, `by boat and road (${fmt(s.km.foot)} km on foot)`), kpi(`${fmt(s.fuelL)} L`, 'fuel a year'),
          kpi(kit.seasons ? `+${fmt(s.seasonPct)}%` : 'off', 'travel time from the seasons')),
        el('div', { class: `rd-load${over ? ' is-over' : ''}` }, el('b', { text: `${fmt(s.busyShare * 100)}%` }), el('span', { text: over
          ? `of the crews' duty days: more work than they have days for, so trips slip, repairs wait and ${fmt(s.unfit)} trips do not happen this year. Repairs at far minor hubs each need their own trip; add a crew, let faults wait for the next trip, or add village caretakers.`
          : `of the crews' duty days are spent on rounds, stays and repairs.` })),
        el('div', { class: 'rd-live-w' }, el('h3', { class: 'co-h', text: 'Right now' }), live),
        el('p', { class: 'co-note' }, `Settings from "What's at a station": ${kit.team} rangers a team, ${kit.workDays} working days a stay, ${kit.days} field days a ranger (on ${sim.onDays} days, off ${CYCLE - sim.onDays}), ${fmt(kit.routine, 1)} routine and ${fmt(kit.repair, 2)} repair visits a speaker a year${kit.caretaker ? ', village caretakers' : ''}. Faults come at random; a trip to the same place within the wait allowed picks them up, else they get their own trip (1 working day).`),
        el('p', { class: 'co-note' }, tag('Modeled', 'proxy'), ` Places and routes are the default hub design (a long day out) on the SRR travel model: 14 km cells, boat 25 km/h on rivers, motorbike 30 on roads, 3 on foot. Seasons (an estimate by latitude zone, analysis/data/seasons.json): the rains halve unpaved-road speed and slow forest paths to three quarters at their height, low water slows boats to 70%; planned, routine stays go in each route's six easiest months, repairs go when the fault comes.`))));
  requestAnimationFrame(() => { draw(); if (V.play) start(); });
  return node;
}
