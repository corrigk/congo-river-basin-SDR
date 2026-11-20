// Prints every number the Design tab's alerting-chain steps quote (Who must hear it, How far a voice carries), from
// the committed data and the same acoustic model the page runs.   node scripts/coverage-report.mjs
import fs from 'node:fs';
import { briefTable, rangeTo, threshold, value, paths, CASES, areaKm2 } from '../src/s3/coverage/acoustics.js';

const read = f => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const U = read('analysis/data/urbanisation.json'), core = read('src/s3/v2/data/core.json'), bare = read('designs/bare-minimum.json');
const SP = read('analysis/data/speakers.json'), SS = read('analysis/data/stations_speaker.json');
const Y = '2041', y = U.by_year[Y], recv = core.sn.community_receivers[Y];
const M = v => `${(v / 1e6).toFixed(1)}M`, pct = v => `${(v * 100).toFixed(1)}%`;

console.log('== Who counts (Degree of Urbanisation on WorldPop 2020 1 km, shares held to 2041; modeled proxy)');
console.log(`  2020 shares: urban centres ${pct(U.share_2020.urban_centre)} (${U.urban_centres.count}), towns and peri-urban ${pct(U.share_2020.town_periurban)}, rural ${pct(U.share_2020.rural)}`);
console.log(`  ${Y}: all ${M(y.total)}, rural + peri-urban ${M(y.town_periurban + y.rural)} (design), urban centres ${M(y.urban_centre)}`);
console.log(`  settled 1 km cells outside urban centres: ${U.settled_cells_outside_centres.count.toLocaleString('en-US')}`);

console.log('\n== Thresholds (ambient + margin, + building loss indoors)');
for (const [id, c] of Object.entries(CASES)) console.log(`  ${c.label}: ${threshold(id)} dB`);

console.log('\n== Brief §5.3 table, recomputed (124 dB, D=10, air 5 dB/km, 300 m clearing; km)');
for (const r of briefTable()) console.log(`  ${r.t} dB  ${r.km.map(x => x.km.toFixed(2)).join('  ')}`);

console.log('\n== Village speaker (T1), base values, design case (outdoors at night)');
const base = { L0: value('src_t1_db'), dLand: value('d_land_db'), dWater: value('d_water_db'), air: value('air_db_km'), forest: value('forest_db_100m'), clearing: value('clearing_m') };
const t = threshold('night');
for (const [k, o] of Object.entries(paths(base))) { const r = rangeTo(t, o); console.log(`  ${o.label.padEnd(36)} ${Math.round(r)} m (${areaKm2(r).toFixed(2)} km2)`); }
const vr = b => { const v = id => value(id, b[id] || 'base'); return rangeTo(threshold('night', b), { L0: v('src_t1_db'), D: v('d_land_db'), airDbKm: v('air_db_km'), forestDb100: v('forest_db_100m'), clearingM: v('clearing_m') }); };
console.log(`  village radius across the range: ${Math.round(vr({ forest_db_100m: 'high', src_t1_db: 'low' }))}–${Math.round(vr({ forest_db_100m: 'low', src_t1_db: 'high' }))} m`);

console.log('\n== Scale check (brief §4.2)');
const villages = recv.rural_pop / value('people_per_village');
const srr = core.budget.sweet_spots.find(s => s.run === 'mix_2041').stations;
console.log(`  rural people ${M(recv.rural_pop)} -> ~${Math.round(villages / 1000)}k villages of ${value('people_per_village')} (receivers today: ${recv.receivers.toLocaleString('en-US')})`);
console.log(`  one village speaker each: ~${Math.round(villages / 1000)}k speakers; ${Math.round(villages / srr).toLocaleString('en-US')} per station with ${srr} stations, ${Math.round(villages / bare.n).toLocaleString('en-US')} with the bare minimum's ${bare.n}`);
console.log(`  installed: $${(villages * value('t1_installed_usd', 'low') / 1e9).toFixed(1)}–${(villages * value('t1_installed_usd', 'high') / 1e9).toFixed(1)}B at $${value('t1_installed_usd', 'low')}–${value('t1_installed_usd', 'high')} each, vs the $400M cap`);

console.log('\n== Speakers and receivers (modeled proxy on WorldPop 1 km; site_speakers.py)');
const sy = SP.by_year[SP.year];
console.log(`  ${SP.year}: ${sy.t1.toLocaleString('en-US')} village speakers hear ${M(sy.t1_heard)} (${sy.t1_heard_pct}% of ${M(sy.design_pop)}); ${sy.t2.toLocaleString('en-US')} receivers for ${M(sy.t2_pop)}; urban centres ${M(sy.urban_pop)}`);
for (const b of ['high', 'base', 'low']) console.log(`  ${b.padEnd(4)}: voice ${SP.bands[b].radius_m} m, cutoff ${SP.bands[b].cutoff}: ${SP.bands[b].t1.toLocaleString('en-US')} speakers, ${SP.bands[b].t1_heard_pct}%`);
console.log(`  rollout: first tenth mean hazard ${SP.rollout.first_tenth_mean_hazard} vs ${SP.rollout.all_mean_hazard} for all speakers`);
console.log(`  by year: ${Object.entries(SP.by_year).map(([y, v]) => `${y} ${v.t1.toLocaleString('en-US')}`).join(', ')}`);

console.log('\n== Ranger stations derived from the speakers (stations_from_speakers.py)');
console.log(`  X = ${SS.X} speakers per station (${Object.entries(SS.x_formula).map(([k, v]) => `${k} ${v}`).join(', ')}), longest trip ${SS.T_maint_h} h`);
console.log(`  ${SS.stations.length.toLocaleString('en-US')} stations at ${SS.sites} sites; ${SS.assigned.toLocaleString('en-US')} speakers assigned, ${SS.unassigned.toLocaleString('en-US')} beyond reach; SRR sweet spot ${SS.compare.srr_sweet_spot}`);
const last = SS.runs['2041'].stations.at(-1);
console.log(`  these stations: ${last.cum_pct}% of people by radio or 1-hour response, $${last.cum_cost_musd}M over 15 years`);
for (const [t, rows] of Object.entries(SS.sweep)) console.log(`  ${t.padStart(2)} h: ${rows.map(r => `X ${r.X}: ${r.stations}`).join(' · ')}`);
