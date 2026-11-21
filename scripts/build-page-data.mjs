// Turn the analysis pipeline's outputs (analysis/data) into the files the page loads (src/s3/v2/data),
// split so each section fetches only what it needs:
//   core.json            functions, databases, costs, comms, LEO, budget, sensors, infrastructure, sources (all sections)
//   geo.json             basin, rivers, lakes, roads, countries, protected areas (maps)
//   grid.json            population grid: cell index, country, area, distance to river / road (maps)
//   pop-<year>.json      people per cell for one year (maps)
//   stations-<year>.json the four coverage modes' station order, curve and first-covered map for one year
//   hazards.json         conflict, fire and flood layers for the ConOps "why" map
//   today.json           towns with a modeled terrestrial-reach radius, for the ConOps "today" step
//   coverage.json        village speakers and receivers per cell, and the ranger stations derived from them
//                        (site_speakers.py, stations_from_speakers.py), for the Design tab's speakers and stations steps
// Run after rerunning the pipeline:  npm run data:page
import fs from 'node:fs';

const SRC = new URL('../analysis/data/', import.meta.url);
const OUT = new URL('../src/s3/v2/data/', import.meta.url);
const read = f => JSON.parse(fs.readFileSync(new URL(f, SRC), 'utf8'));
const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
fs.mkdirSync(OUT, { recursive: true });
const sizes = [];
const write = (name, obj) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(new URL(name, OUT), s);
  sizes.push(`${name} ${(s.length / 1024).toFixed(0)} kB`);
};

// Coordinates: 3 decimals (about 100 m) is plenty at basin scale.
const roundCoords = c => (typeof c[0] === 'number' ? [r(c[0], 3), r(c[1], 3)] : c.map(roundCoords));
const slimFC = fc => ({ type: 'FeatureCollection', features: fc.features.map(f => ({ type: 'Feature', properties: f.properties, geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) } })) });

const sensors = read('sensors.json');
const pa = read('protected_areas.json');
write('core.json', {
  fn: read('functions.json'),
  db: read('databases.json'),
  cost: read('cost_model.json'),
  comms: read('comms_options.json'),
  leo: read('leo_revisit.json'),
  budget: read('budget.json'),
  infra: read('infrastructure.json'),
  sources: read('sources.json'),
  sn: sensors,
});

const pop = read('population.json');
write('geo.json', {
  basin: slimFC(read('basin.geojson')), rivers: slimFC(read('rivers.geojson')), lakes: slimFC(read('lakes.geojson')),
  roads: slimFC(read('roads.geojson')), countries: slimFC(read('countries.geojson')),
  pa: { ...pa, areas: pa.areas.map(a => (a.geometry ? { ...a, geometry: { type: a.geometry.type, coordinates: roundCoords(a.geometry.coordinates) } } : a)) },
});
write('grid.json', {
  mode: pop.mode, res_deg: pop.res_deg, years: pop.years, lon0: pop.lon0, lat0: pop.lat0, nx: pop.nx, ny: pop.ny, summary: pop.summary,
  i: pop.cells.i, country: pop.cells.country, km2: pop.cells.km2, river_km: pop.cells.river_km, road_km: pop.cells.road_km,
});
for (const y of pop.years) write(`pop-${y}.json`, pop.pop[String(y)]);

// ConOps "today" layer: the towns and cities we hold, each with a MODELED reach radius for the terrestrial network
// around it (proxy until real tower data, e.g. OpenCelliD, is added): 40 km for 1M+, 25 km for 250k+, 15 km for 50k+, else 8 km.
const reachKm = p => (p >= 1e6 ? 40 : p >= 2.5e5 ? 25 : p >= 5e4 ? 15 : 8);
write('today.json', {
  _note: 'MODELED PROXY: reach radius by town size, not measured coverage.',
  rule_km: { '1M+': 40, '250k+': 25, '50k+': 15, 'smaller': 8 },
  towns: read('towns_raw.json').map(t => ({ name: t.name, cc: t.cc, lon: r(t.lon, 3), lat: r(t.lat, 3), pop: t.pop, r: reachKm(t.pop) })),
});

// ConOps "why" layers: conflict, fire and flood on the same grid (analysis/scripts/build_hazards.py).
if (fs.existsSync(new URL('hazards.json', SRC))) write('hazards.json', read('hazards.json'));

// Village speakers and the stations that look after them (modeled proxy until GRID3, Stage 3).
const spk = fs.existsSync(new URL('speakers.json', SRC)) ? read('speakers.json') : null;
const sts = fs.existsSync(new URL('stations_speaker.json', SRC)) ? read('stations_speaker.json') : null;
const hubs = fs.existsSync(new URL('hubs.json', SRC)) ? read('hubs.json') : null; // major and minor hubs (hubs_from_speakers.py)
if (spk && sts) {
  write('coverage.json', {
    _note: spk._note, year: spk.year, radius_m: spk.radius_m, cutoff_people: spk.cutoff_people, people_per_receiver: spk.people_per_receiver,
    hazard_weights: spk.hazard_weights, by_year: spk.by_year, bands: spk.bands, curve: spk.curve, rollout: spk.rollout,
    cells: { t1: spk.cells.t1, heard: spk.cells.heard, t2: spk.cells.t2.map(v => Math.round(v)), hazard: spk.cells.hazard.map(v => r(v, 2)),
      urban: spk.cells.urban.map(v => (v > 0 ? 1 : 0)), grid3: spk.cells.grid3 || [] },
    sources: spk.sources,
    stations: { _note: sts._note, T_maint_h: sts.T_maint_h, X: sts.X, x_formula: sts.x_formula, speakers: sts.speakers, assigned: sts.assigned,
      unassigned: sts.unassigned, sites: sts.sites, compare: sts.compare, sweep: sts.sweep, owner_b64: sts.owner_b64,
      list: sts.stations.map(s => [r(s.lon, 3), r(s.lat, 3), s.type, s.n_speakers, s.max_travel_h, s.mean_travel_h]) },
    hubs: hubs && { speakers: hubs.speakers, t_local_h: hubs.t_local_h, t_day_h: hubs.t_day_h, t_days: hubs.t_days, min_minor: hubs.min_minor,
      min_remote: hubs.min_remote, service_hubs: hubs.service_hubs, sweep: hubs.sweep, default: hubs.default,
      majors: hubs.majors, minors: hubs.minors, village_stays: hubs.village_stays },
  });
}

const st = read('stations.json');
for (const y of pop.years) {
  const runs = {};
  // 'alerts': the major hubs (minor hubs are empty most of the time, so they do not count for response);
  // 'alerts_day': every speaker-derived site a full station on day trips (the Ranger stations step)
  for (const mode of ['radio', 'response', 'speaker', 'mix', 'alerts', 'alerts_day']) {
    const run = mode === 'alerts' ? (hubs ?? sts)?.runs[String(y)] : mode === 'alerts_day' ? sts?.runs[String(y)] : st.runs[`${mode}_${y}`];
    if (!run) continue;
    runs[mode] = {
      ...run,
      stations: run.stations.map(s => ({ ...s, lat: r(s.lat, 3), lon: r(s.lon, 3) })),
    };
  }
  write(`stations-${y}.json`, { year: y, method: st._method, mix_weights: st.mix_weights, station_cost_15yr: st.station_cost_15yr,
    hydro_river_station_15yr: st.hydro_river_station_15yr, nmax: st.nmax, runs });
}
console.log(sizes.join('\n'));
