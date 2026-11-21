// What is at a ranger hub, what its crews do, and what that costs (Design tab, "What's at a station").
//
//   major hub      where crews live: building, tower, loudspeaker, radios, backhaul, S-3 terminal, kit, power sized
//                  from the loads, boats or motorbikes, plus what its access (road, river, remote) adds
//   minor hub      an outstation where one or two rangers stay a night or two and work the speakers around it on day
//                  trips: shelter, relay mast, terminal, small solar; nobody lives there. Under 10 speakers it is not
//                  built: rangers lodge in the village (a village stay).
//   capacity       team-days a year = crews x people x field days / rangers per team
//                  per speaker a year = visits x (on site + 2 x trip / per round) / day hours                (day trips)
//                                     = visits x (on site + 2 x local trip / per round) / day hours
//                                       x (1 + 2 x trip to the minor hub / (work days per stay x day hours))   (stays)
//                  X (speakers per major, with its most crews) = team-days / the mix of the two; each major hub then
//                  gets only the crews its speakers need (most are set by reach, not capacity, and need one)
//   how many       interpolated on X from the hub derivation (analysis/scripts/hubs_from_speakers.py), for the
//                  longest trip allowed to a minor hub (8, 12 or 24 h)
//   cost           parts x the site's logistics multiplier, maintenance (6% of capex a year), backhaul and rent,
//                  battery swaps, vehicle replacement, fuel for the motorised legs. People costs (salaries, field
//                  allowances, caretaker stipends) are shown on their own line and counted only when switched on.
// Catalog: analysis/data/station_kit.json (every figure labelled srr / published / estimate).
import KIT from '../../../analysis/data/station_kit.json' with { type: 'json' };
import { PHYS, physFor, relayBudget } from '../../sdr/physics.js';
import { rangeTo, value } from './acoustics.js';

export { KIT };
const LIFE = 15, TYPES = ['road', 'river', 'remote'];
export const LOGISTICS = KIT.access.logistics;
const b = (sec, k) => KIT[sec][k].base;
const opt = (sec, part, id) => KIT[sec][part].options.find(o => o.id === id) || KIT[sec][part].options[0];
const sum = a => a.reduce((x, y) => x + y, 0);

export const DEFAULT_KIT = () => ({
  building: 'prefab', tower: 'lattice30', speaker: 'array', radio: 'repeater', backhaul: 'starlink',
  minorBuilding: 'shelter', minorMast: 'pole9', minorBackhaul: 'none', caretaker: false,
  crews: b('crew', 'crews'), people: b('crew', 'people'), days: b('crew', 'field_days'), team: b('crew', 'team'), dayH: b('crew', 'day_h'),
  routine: b('visits', 'routine_yr'), repair: b('visits', 'repair_yr'), onsite: b('visits', 'onsite_h'), perRound: b('visits', 'per_round'),
  workDays: b('stay', 'work_days'), tDay: b('stay', 't_day_h'), hubs: true,
  fuelUsdL: b('crew', 'fuel_usd_l'), motorShare: b('crew', 'motor_share'), countPeople: false,
});

// Interpolate a sweep table on log X.
function interp(rows, X, key) {
  const g = r => (typeof key === 'function' ? key(r) : r[key]);
  if (X <= rows[0].X) return g(rows[0]);
  for (let i = 1; i < rows.length; i++) if (X <= rows[i].X) {
    const a = rows[i - 1], c = rows[i], t = (Math.log(X) - Math.log(a.X)) / (Math.log(c.X) - Math.log(a.X));
    return g(a) + t * (g(c) - g(a));
  }
  return g(rows[rows.length - 1]);
}
// Crews the major hubs need: each hub's speakers over one crew's share of X, at least one, at most the setting.
function crewsNeeded(loads, X, kit) {
  const perCrew = X / kit.crews; let n = 0, c = 0;
  for (const [count, mean] of loads) { n += count; c += count * Math.min(kit.crews, Math.max(1, Math.ceil(mean / perCrew))); }
  return n ? c / n : kit.crews; // average crews per major hub
}
const nearestRow = (rows, X) => rows.reduce((a, r) => (Math.abs(Math.log(r.X / X)) < Math.abs(Math.log(a.X / X)) ? r : a));
const shares = (rows, X, key) => { const v = Object.fromEntries(TYPES.map(t => [t, Math.max(0, interp(rows, X, r => r[key][t]))])), s = sum(Object.values(v)) || 1; return Object.fromEntries(TYPES.map(t => [t, v[t] / s])); };

// Major-hub power from its loads (same method as the Trades physics: autonomy days of normal load plus one alert).
function power(kit) {
  const P = PHYS.power, sp = opt('main', 'speaker', kit.speaker), rd = opt('main', 'radio', kit.radio), bh = opt('main', 'backhaul', kit.backhaul);
  const loads = [
    ['Radios', rd.watts, 24], ['S-3 terminal', 10, 24], [`Backhaul (${bh.name})`, bh.watts, 24],
    ['Ops room: lights, laptop, chargers', kit.building === 'shared' ? 60 : 120, 6], ['Medical fridge', 25, 24], ['Sensor and handheld charging', 50, 4],
  ].filter(l => l[1] > 0).map(([name, w, h]) => ({ name, w, h, wh: w * h }));
  const normal = sum(loads.map(l => l.wh)), alert = sp.watts * P.alertHours;
  const battKwh = (normal * P.autonomyDays + alert) / 1000 / 0.8 / P.invEff;
  const pvKwp = (normal * P.recharge + alert / P.autonomyDays) / 1000 / (P.psh * P.pr);
  const usd = pvKwp * 1000 * 2.0 + battKwh * 400 + 3000;
  return { loads, normal, alert, battKwh, pvKwp, usd, battUsd: battKwh * 400 };
}

// The crews' workload per speaker a year, in team-days, and X.
function workload(kit, r) {
  const vDir = kit.routine + kit.repair, vStay = kit.routine * (kit.caretaker ? 0.5 : 1) + kit.repair;
  const perD = (vDir * (kit.onsite + (2 * r.td) / kit.perRound)) / kit.dayH;
  const perS = ((vStay * (kit.onsite + (2 * r.tl) / kit.perRound)) / kit.dayH) * (1 + (2 * r.tdep) / (kit.workDays * kit.dayH));
  const cap = (kit.crews * kit.people * kit.days) / kit.team;
  return { vDir, vStay, perD, perS, cap, X: cap / (r.s * perD + (1 - r.s) * perS) };
}

// cov: coverage.json (its hubs and stations). Returns the hub design, its capacity, how many, and its cost.
export function evaluateKit(kit, cov) {
  if (!kit.hubs) return evaluateDayTrips(kit, cov);
  const H = cov.hubs, rows = H.sweep[String(kit.tDay)], speakers = H.speakers;
  const at = X => ({ s: interp(rows, X, 'share_direct'), td: interp(rows, X, 't_direct_h'), tdep: interp(rows, X, 't_dep_h'), tl: interp(rows, X, 't_loc_h') });
  let X = 500, r = at(X), w;
  for (let i = 0; i < 8; i++) { w = workload(kit, r); X = Math.max(50, w.X); r = at(X); }
  X = Math.floor(X);
  const nMajor = Math.max(1, Math.round(interp(rows, X, 'majors'))), nMinor = Math.round(interp(rows, X, 'minors')), nVillage = Math.round(interp(rows, X, 'village_stays'));
  const mShare = shares(rows, X, 'major_types'), nShare = shares(rows, X, 'minor_types');
  const types = Object.fromEntries(TYPES.map(t => [t, Math.round(nMajor * mShare[t])])), mtypes = Object.fromEntries(TYPES.map(t => [t, Math.round(nMinor * nShare[t])]));

  // ----- the crews' year -----
  const stayN = (1 - r.s) * speakers, dayN = r.s * speakers;
  const perStay = (kit.workDays * kit.dayH) / (kit.onsite + (2 * r.tl) / kit.perRound); // speakers worked per stay
  const staysYr = (stayN * w.vStay) / perStay, daysPerStay = kit.workDays + (2 * r.tdep) / kit.dayH;
  const avgCrews = crewsNeeded(nearestRow(rows, X).load_hist, X, kit), crews = Math.round(nMajor * avgCrews);
  const rangers = crews * kit.people, rangerNights = staysYr * kit.team * daysPerStay;
  const dayRoundsYr = (dayN * w.vDir) / kit.perRound;
  // motorised hours a year, all hubs: day rounds, travel to and from the minor hubs, local rounds from them
  const motorH = kit.motorShare * (dayRoundsYr * 2 * r.td + staysYr * 2 * r.tdep + ((stayN * w.vStay) / kit.perRound) * 2 * r.tl);

  // ----- one major hub, by access -----
  const pw = power(kit), bh = opt('main', 'backhaul', kit.backhaul), bd = opt('main', 'building', kit.building), tw = opt('main', 'tower', kit.tower), sp = opt('main', 'speaker', kit.speaker), rd = opt('main', 'radio', kit.radio);
  const parts = [
    ['Building', bd.name, bd.usd, bd.basis], ['Tower', tw.name, tw.usd, tw.basis], ['Loudspeaker', sp.name, sp.usd, sp.basis],
    ['Radios', rd.name, rd.usd, rd.basis], ['Backhaul', bh.name, bh.usd, bh.basis], ['S-3 terminal', KIT.main.terminal.label, KIT.main.terminal.usd, KIT.main.terminal.basis],
    ['Kit', KIT.main.kit.label, KIT.main.kit.usd, KIT.main.kit.basis], ['Power', `Solar ${pw.pvKwp.toFixed(1)} kWp + ${pw.battKwh.toFixed(0)} kWh LiFePO4, sized to the loads`, pw.usd, 'estimate'],
  ];
  const fixedCapex = sum(parts.map(p => p[2]));
  const veh = t => (t === 'river' ? KIT.crew.boat : KIT.crew.moto);
  const fuelPerMotorH = t => { const v = veh(t); return v.speed_kmh * v.fuel_l_per_km * kit.fuelUsdL * (t === 'remote' ? 0.5 : 1); }; // remote: half the motor legs (on foot)
  const motorHPerMajor = motorH / nMajor;
  const byType = Object.fromEntries(TYPES.map(t => {
    const v = veh(t), extras = sum(KIT.access.major[t].map(i => i.usd)), lm = LOGISTICS[t];
    const capex = (fixedCapex + extras + avgCrews * v.usd) * lm;
    const fuel = motorHPerMajor * fuelPerMotorH(t);
    const opexYr = (fixedCapex + extras) * lm * KIT.opex.maintenance_pct_yr + (bh.opex_yr || 0) + (bd.opex_yr || 0) + fuel;
    const repl = pw.battUsd * Math.floor((LIFE - 1) / 8) + avgCrews * v.usd * Math.max(0, Math.ceil(LIFE / v.life_yr) - 1);
    return [t, { capex, opexYr, fuelYr: fuel, repl, extras, total15: capex + opexYr * LIFE + repl }];
  }));
  const majorTotal = sum(TYPES.map(t => types[t] * byType[t].total15));

  // ----- one minor hub, by access -----
  const mb = opt('minor', 'building', kit.minorBuilding), mm = opt('minor', 'mast', kit.minorMast), mx = opt('minor', 'backhaul', kit.minorBackhaul);
  const minorParts = [['Shelter', mb.name, mb.usd, mb.basis], ['Relay', mm.name, mm.usd, mm.basis], ['Internet', mx.name, mx.usd, mx.basis],
    ...KIT.minor.fixed.map((i, k) => [['Terminal', 'Power', 'Kit'][k] || 'Other', i.name, i.usd, i.basis])];
  const minorCapex0 = sum(minorParts.map(p => p[2]));
  const minorByType = Object.fromEntries(TYPES.map(t => {
    const extras = sum(KIT.access.minor[t].map(i => i.usd)), lm = LOGISTICS[t], capex = (minorCapex0 + extras) * lm;
    const opexYr = capex * KIT.opex.maintenance_pct_yr + (mx.opex_yr || 0) + (mb.opex_yr || 0);
    const repl = 1200 * Math.floor((LIFE - 1) / KIT.minor.battery_life_yr); // the 3 kWh battery
    return [t, { capex, opexYr, repl, extras, total15: capex + opexYr * LIFE + repl }];
  }));
  const minorTotal = sum(TYPES.map(t => mtypes[t] * minorByType[t].total15));

  // ----- people costs (shown; counted only when switched on) -----
  const salaries15 = rangers * KIT.crew.salary_usd_yr.base * LIFE;
  const allowance15 = rangerNights * b('stay', 'allowance_usd_night') * LIFE;
  const stipends15 = kit.caretaker ? (nMinor + nVillage) * KIT.minor.caretaker.usd_yr * LIFE : 0;
  const people15 = allowance15 + stipends15;
  const total = majorTotal + minorTotal + (kit.countPeople ? people15 : 0);

  const relay = relayBudget(physFor({}), tw.height_m), minorRelay = mm.height_m ? relayBudget(physFor({}), mm.height_m) : { km: 0 };
  const spkM = sp.db ? rangeTo(value('ambient_night_dba') + value('margin_db'), { L0: sp.db, D: value('d_land_db'), airDbKm: value('air_db_km'), forestDb100: value('forest_db_100m'), clearingM: value('clearing_m') }) : 0;
  return {
    hubs: true, X, w, r, tDay: kit.tDay, nMajor, nMain: nMajor, crews, avgCrews, nMinor, nVillage, types, mtypes, speakers, perMajor: speakers / nMajor,
    staysYr, daysPerStay, perStay, rangers, rangerNights, nightsPerRanger: rangerNights / rangers, dayRoundsYr, unserved: 0,
    parts, fixedCapex, power: pw, byType, majorTotal, avgMajor15: majorTotal / nMajor,
    minorParts, minorCapex0, minorByType, minorTotal, avgMinor15: nMinor ? minorTotal / nMinor : 0,
    salaries15, allowance15, stipends15, people15, total,
    spec: { downMbps: bh.down_mbps, upMbps: bh.up_mbps, relayKm: relay.km, towerM: tw.height_m, speakerM: spkM, crewPeople: avgCrews * kit.people, minorRelayKm: minorRelay.km, minorMastM: mm.height_m },
  };
}

// Without minor hubs: every major hub works its speakers on day trips (up to 8 h), as the station derivation
// (stations_from_speakers.py); speakers beyond 8 h of every site stay unserved.
function evaluateDayTrips(kit, cov) {
  const st = cov.stations, rows = st.sweep[String(st.T_maint_h)];
  let X = st.X, td = 0;
  for (let i = 0; i < 6; i++) { td = interp(rows, X, 'mean_trip_h'); X = workload({ ...kit, caretaker: false }, { s: 1, td, tdep: 0, tl: 0 }).X; }
  X = Math.max(20, Math.floor(X));
  const nMajor = Math.max(1, Math.round(interp(rows, X, 'stations'))), unserved = Math.round(interp(rows, X, 'unassigned'));
  const types = { road: 0, river: 0, remote: 0 };
  for (const s of st.list.slice(0, nMajor)) types[s[2]]++;
  const list = st.list.slice(0, nMajor), avgCrews = crewsNeeded(list.map(s => [1, s[3]]), X, kit), crews = Math.round(nMajor * avgCrews);
  const base = evaluateKit({ ...kit, hubs: true }, cov); // for the hub parts and per-type costs
  const speakers = st.assigned, vDir = kit.routine + kit.repair, dayRoundsYr = (speakers * vDir) / kit.perRound;
  const motorHPerMajor = (kit.motorShare * dayRoundsYr * 2 * td) / nMajor;
  const byType = Object.fromEntries(TYPES.map(t => {
    const v = t === 'river' ? KIT.crew.boat : KIT.crew.moto, o = base.byType[t];
    const fuel = motorHPerMajor * v.speed_kmh * v.fuel_l_per_km * kit.fuelUsdL * (t === 'remote' ? 0.5 : 1), opexYr = o.opexYr - o.fuelYr + fuel;
    const veh = v.usd * (avgCrews - base.avgCrews), capex = o.capex + veh * LOGISTICS[t], repl = o.repl + veh * Math.max(0, Math.ceil(LIFE / v.life_yr) - 1);
    return [t, { ...o, capex, repl, fuelYr: fuel, opexYr, total15: capex + opexYr * LIFE + repl }];
  }));
  const majorTotal = sum(TYPES.map(t => types[t] * byType[t].total15)), rangers = crews * kit.people;
  return {
    ...base, hubs: false, X, r: { s: 1, td, tdep: 0, tl: 0 }, nMajor, nMain: nMajor, crews, avgCrews, nMinor: 0, nVillage: 0, types, mtypes: { road: 0, river: 0, remote: 0 },
    speakers, perMajor: speakers / nMajor, staysYr: 0, daysPerStay: 0, rangers, rangerNights: 0, nightsPerRanger: 0, dayRoundsYr, unserved,
    byType, majorTotal, avgMajor15: majorTotal / nMajor, minorTotal: 0, avgMinor15: 0,
    salaries15: rangers * KIT.crew.salary_usd_yr.base * LIFE, allowance15: 0, stipends15: 0, people15: 0, total: majorTotal,
  };
}

// Ranger setups, with the speakers fixed: what each costs and what it asks of the crews.
export const SETUPS = [
  { id: 'day', name: 'Major hubs only, day trips', kit: { hubs: false, caretaker: false },
    pros: ['Crews sleep at home every night', 'Every hub is staffed, so all of them count for response'], cons: ['Many more staffed hubs', 'Speakers deep in the forest stay out of reach'] },
  { id: 'h8', name: 'Major + minor hubs, one day out', kit: { hubs: true, tDay: 8, workDays: 2, caretaker: false, minorBuilding: 'shelter' },
    pros: ['Rangers are back within four or five days', 'Reaches every speaker'], cons: ['Many major hubs where rivers and roads are sparse'] },
  { id: 'h12', name: 'Major + minor hubs, a long day out', kit: { hubs: true, tDay: 12, workDays: 3, caretaker: false, minorBuilding: 'shelter' },
    pros: ['Fewer major hubs', 'Three working days per stay'], cons: ['Long travel days on the river', 'Five- to six-day absences'] },
  { id: 'h24', name: 'Few major hubs, two days out', kit: { hubs: true, tDay: 24, workDays: 5, caretaker: false, minorBuilding: 'shelter' },
    pros: ['Fewest major hubs', 'Crews concentrated where supplies are'], cons: ['Nine-day trips: many nights away for every ranger', 'Slow repair when a speaker fails', 'More fuel per visit'] },
  { id: 'care', name: 'Hubs + village caretakers + rented rooms', kit: { hubs: true, caretaker: true, minorBuilding: 'rented' },
    pros: ['Caretakers check speakers after each monthly test: half the routine visits', 'Rented rooms at health centres or schools cost little to set up'], cons: ['Depends on partners and caretakers', 'Stipends are a running people cost'] },
];
export function evaluateSetups(kit, cov) {
  return SETUPS.map(s => ({ ...s, P: evaluateKit({ ...kit, ...s.kit }, cov) }));
}
