// What is at a ranger station, what its crews do, and what that costs (Design tab, "What's at a station").
//
//   main station   building, tower, loudspeaker, radios, backhaul, S-3 terminal, kit, power sized from the loads,
//                  and crews with boats or motorbikes
//   waypoint post  mast, small solar, relay radio, locked shelter: crews stop there on longer circuits
//   capacity       X = crews x crew hours a year / (visits per speaker a year x (hours on site + 2 x trip / speakers per round))
//   how many       main stations: interpolated from the speaker-to-station derivation (stations_from_speakers.py) at
//                  this X, for 8 h day trips, or 24 h circuits when posts are on; posts replace the stations that day
//                  trips would need and circuits do not
//   cost           per station: parts x the site's logistics multiplier, maintenance (6% of capex a year), backhaul and
//                  rent, battery swaps, vehicle replacement, fuel for the rounds; salaries shown, not counted
// Catalog: analysis/data/station_kit.json (every figure labelled srr / published / estimate).
import KIT from '../../../analysis/data/station_kit.json' with { type: 'json' };
import { PHYS, physFor, relayBudget } from '../../sdr/physics.js';
import { rangeTo, value } from './acoustics.js';

export { KIT };
const LIFE = 15;
const opt = (part, id) => KIT.main[part].options.find(o => o.id === id) || KIT.main[part].options[0];

export const DEFAULT_KIT = () => ({
  building: 'prefab', tower: 'lattice30', speaker: 'array', radio: 'repeater', backhaul: 'starlink',
  crews: KIT.crew.crews.base, people: KIT.crew.people.base, hoursYr: KIT.crew.hours_yr.base,
  routine: KIT.visits.routine_yr.base, repair: KIT.visits.repair_yr.base, onsite: KIT.visits.onsite_h.base, perRound: KIT.visits.per_round.base,
  posts: true, fuelUsdL: KIT.crew.fuel_usd_l.base, motorShare: KIT.crew.motor_share.base,
});

// Interpolate the X x trip table on log X (for station count and the average one-way trip).
function interp(rows, X, key) {
  if (X <= rows[0].X) return rows[0][key];
  for (let i = 1; i < rows.length; i++) if (X <= rows[i].X) {
    const a = rows[i - 1], b = rows[i], t = (Math.log(X) - Math.log(a.X)) / (Math.log(b.X) - Math.log(a.X));
    return a[key] + t * (b[key] - a[key]);
  }
  return rows[rows.length - 1][key];
}

// Station power from its loads (same method as the Trades physics: autonomy days of normal load plus one alert).
function power(kit) {
  const P = PHYS.power, sp = opt('speaker', kit.speaker), rd = opt('radio', kit.radio), bh = opt('backhaul', kit.backhaul);
  const loads = [
    ['Radios', rd.watts, 24], ['S-3 terminal', 10, 24], [`Backhaul (${bh.name})`, bh.watts, 24],
    ['Ops room: lights, laptop, chargers', kit.building === 'shared' ? 60 : 120, 6], ['Medical fridge', 25, 24], ['Sensor and handheld charging', 50, 4],
  ].filter(l => l[1] > 0).map(([name, w, h]) => ({ name, w, h, wh: w * h }));
  const normal = loads.reduce((a, l) => a + l.wh, 0), alert = sp.watts * P.alertHours;
  const battKwh = (normal * P.autonomyDays + alert) / 1000 / 0.8 / P.invEff;
  const pvKwp = (normal * P.recharge + alert / P.autonomyDays) / 1000 / (P.psh * P.pr);
  const usd = pvKwp * 1000 * 2.0 + battKwh * 400 + 3000;
  return { loads, normal, alert, battKwh, pvKwp, usd, battUsd: battKwh * 400 };
}

// cov: coverage.json (speakers and the station derivation). Returns the station design, its capacity, how many, cost.
export function evaluateKit(kit, cov) {
  const st = cov.stations, sweep = st.sweep, speakers = st.assigned;
  const reachH = kit.posts ? KIT.post.round_h : st.T_maint_h, rows = sweep[String(reachH)];
  const perRound = kit.perRound * (kit.posts ? KIT.post.round_h / st.T_maint_h : 1); // longer circuits string more stops
  const visits = kit.routine + kit.repair;
  // X depends on the average trip, which depends a little on X: a few fixed-point steps
  let X = st.X, trip = 0;
  for (let i = 0; i < 6; i++) { trip = interp(rows, X, 'mean_trip_h'); X = (kit.crews * kit.hoursYr) / (visits * (kit.onsite + (2 * trip) / perRound)); }
  X = Math.max(20, Math.floor(X));
  const nMain = Math.max(1, Math.round(interp(rows, X, 'stations')));
  const nDay = Math.round(interp(sweep[String(st.T_maint_h)], X, 'stations'));
  const nPosts = kit.posts ? Math.max(0, nDay - nMain) : 0;

  // ----- one main station -----
  const pw = power(kit), bh = opt('backhaul', kit.backhaul), bd = opt('building', kit.building), tw = opt('tower', kit.tower), sp = opt('speaker', kit.speaker), rd = opt('radio', kit.radio);
  const parts = [
    ['Building', bd.name, bd.usd, bd.basis], ['Tower', tw.name, tw.usd, tw.basis], ['Loudspeaker', sp.name, sp.usd, sp.basis],
    ['Radios', rd.name, rd.usd, rd.basis], ['Backhaul', bh.name, bh.usd, bh.basis], ['S-3 terminal', KIT.main.terminal.label, KIT.main.terminal.usd, KIT.main.terminal.basis],
    ['Kit', KIT.main.kit.label, KIT.main.kit.usd, KIT.main.kit.basis], ['Power', `Solar ${pw.pvKwp.toFixed(1)} kWp + ${pw.battKwh.toFixed(0)} kWh LiFePO4, sized to the loads`, pw.usd, 'estimate'],
  ];
  const fixedCapex = parts.reduce((a, p) => a + p[2], 0);
  // site types of the stations in use (road / river / remote) set logistics and vehicles
  const types = { road: 0, river: 0, remote: 0 };
  for (const s of st.list.slice(0, nMain)) types[s[2]]++;
  const lm = KIT_LOGISTICS;
  const perSpeaker = speakers / nMain, tripsYr = (perSpeaker * visits) / perRound;
  const veh = t => (t === 'river' ? KIT.crew.boat : KIT.crew.moto);
  const byType = Object.fromEntries(Object.keys(types).map(t => {
    const v = veh(t), capex = (fixedCapex + kit.crews * v.usd) * lm[t];
    const km = tripsYr * 2 * trip * kit.motorShare * v.speed_kmh, fuel = km * v.fuel_l_per_km * kit.fuelUsdL; // motorised legs only
    const opexYr = fixedCapex * lm[t] * KIT.opex.maintenance_pct_yr + (bh.opex_yr || 0) + (bd.opex_yr || 0) + fuel;
    const repl = pw.battUsd * Math.floor((LIFE - 1) / 8) + kit.crews * v.usd * Math.max(0, Math.ceil(LIFE / v.life_yr) - 1);
    return [t, { capex, opexYr, fuelYr: fuel, kmYr: km, repl, total15: capex + opexYr * LIFE + repl }];
  }));
  const mainTotal = Object.entries(types).reduce((a, [t, n]) => a + n * byType[t].total15, 0);
  const postCapex = KIT.post.items.reduce((a, p) => a + p.usd, 0), postTotal15 = postCapex * 1.3 + KIT.post.opex_yr * LIFE; // posts sit in remote places: x1.3
  const salaries15 = nMain * kit.crews * kit.people * KIT.crew.salary_usd_yr.base * LIFE;
  const avg15 = mainTotal / nMain;

  // what the station can do
  const relay = relayBudget(physFor({}), tw.height_m);
  const spkM = sp.db ? rangeTo(value('ambient_night_dba') + value('margin_db'), { L0: sp.db, D: value('d_land_db'), airDbKm: value('air_db_km'), forestDb100: value('forest_db_100m'), clearingM: value('clearing_m') }) : 0;
  return {
    X, trip, perRound, visits, reachH, nMain, nPosts, nDay, types, speakers, perSpeaker, tripsYr,
    parts, fixedCapex, power: pw, byType, avg15, mainTotal, postCapex, postTotal15, postsTotal: nPosts * postTotal15,
    total: mainTotal + nPosts * postTotal15, salaries15,
    spec: { downMbps: bh.down_mbps, upMbps: bh.up_mbps, relayKm: relay.km, towerM: tw.height_m, speakerM: spkM, crewPeople: kit.crews * kit.people },
  };
}
// Logistics multipliers from the SRR cost model (cost to haul and build at the site).
const KIT_LOGISTICS = { road: 1.15, river: 1.3, remote: 1.6 };
export const LOGISTICS = KIT_LOGISTICS;
