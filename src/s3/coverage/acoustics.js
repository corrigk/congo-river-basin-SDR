// How far a voice alert carries: sound level against distance from a speaker, and the distance at which it drops
// below the level people need to hear it. Brief v3 §5 and Appendix B; parameters in analysis/data/acoustic_params.json.
//
//   L(r) = L_src(100 ft) - D log2(r / r0) - air (r - r0) - forest (r - clearing)      for r > clearing
//   heard where L(r) >= ambient + margin (+ building loss indoors)
//
// D is spreading plus ground loss per doubling of distance (6 free field ... 10 vendor outdoor rule; 3-6 over water).
// Terrain shadowing (up to 20 dB when the line of sight is blocked) needs the Copernicus DEM: Stage 3.
// Pure functions: the page and scripts/coverage-report.mjs use the same code.
import P from '../../../analysis/data/acoustic_params.json' with { type: 'json' };

export const PARAMS = P.params;
export const R0 = P.r0_m;
export const value = (id, band = 'base') => PARAMS[id][band];

// opts: { L0, D, airDbKm, forestDb100 = 0, clearingM = Infinity }
export function level(r, { L0, D, airDbKm, forestDb100 = 0, clearingM = Infinity }) {
  const rr = Math.max(r, R0);
  return L0 - D * Math.log2(rr / R0) - (airDbKm * (rr - R0)) / 1000 - (rr > clearingM ? (forestDb100 * (rr - clearingM)) / 100 : 0);
}

// Distance (m) at which the level falls to `threshold` (bisection; the level only falls with distance).
export function rangeTo(threshold, opts, max = 20000) {
  if (level(R0, opts) < threshold) return 0;
  let lo = R0, hi = max;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (level(m, opts) >= threshold) lo = m; else hi = m; }
  return lo;
}

// The three listening cases (brief §5.4). Outdoor at night is the design case: floods and attacks happen at night,
// and insects make the forest edge loudest then.
export const CASES = {
  day: { label: 'Outdoors, by day', ambient: 'ambient_village_day_dba', building: null },
  night: { label: 'Outdoors, at night (design case)', ambient: 'ambient_night_dba', building: null },
  indoor: { label: 'Indoors, windows open, at night', ambient: 'ambient_night_dba', building: 'building_open_db' },
};
export function threshold(caseId, bands = {}) {
  const c = CASES[caseId], b = id => value(id, bands[id] || 'base');
  return b(c.ambient) + b('margin_db') + (c.building ? b(c.building) : 0);
}

// The paths a voice takes (brief §5.3): open ground, along a river, and out of a village clearing into forest.
export function paths(s) {
  return {
    open: { label: 'Open ground', L0: s.L0, D: s.dLand, airDbKm: s.air },
    water: { label: 'Along the river', L0: s.L0, D: s.dWater, airDbKm: s.air },
    village: { label: `Village clearing (${s.clearing} m), then forest`, L0: s.L0, D: s.dLand, airDbKm: s.air, forestDb100: s.forest, clearingM: s.clearing },
  };
}

// The brief's §5.3 table, for checking: tower array at 124 dB, D = 10, air 5 dB/km, 300 m clearing.
export function briefTable() {
  const base = { L0: 124, D: 10, airDbKm: 5 };
  const cols = [
    ['Open, D=10', base], ['Open, D=6', { ...base, D: 6 }],
    ...[2, 6.6, 10, 20].map(f => [`Clearing → forest ${f} dB/100 m`, { ...base, forestDb100: f, clearingM: 300 }]),
  ];
  return [60, 65, 70, 75].map(t => ({ t, km: cols.map(([label, o]) => ({ label, km: rangeTo(t, o) / 1000 })) }));
}

// Area one speaker covers (km²) for a radius in metres.
export const areaKm2 = rM => (Math.PI * rM * rM) / 1e6;
