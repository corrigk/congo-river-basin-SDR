// The bare-minimum design: the cheapest design that meets every Level 0 requirement and the $400M cap, found by
// a deeper run of the optimizer's "cheapest" search (several seeds, more samples and longer climbs than the page
// runs). Writes designs/bare-minimum.json, the design the Trades tab starts from.   node scripts/bare-minimum.mjs
import fs from 'node:fs';
import { evaluateDesign, DEFAULT_DESIGN } from '../src/sdr/engine.js';
import { optimize, objective } from '../src/sdr/optimize.js';

const read = f => JSON.parse(fs.readFileSync(new URL(`../src/s3/v2/data/${f}`, import.meta.url), 'utf8'));
const ctx = { D: read('core.json'), Y: { 2041: read('stations-2041.json') } };
const start = { ...DEFAULT_DESIGN(), includeStaff: false, discountPct: 0 };

let best = null;
for (const seed of [11, 23, 37, 51, 73]) {
  const res = optimize(ctx, start, { samples: 2500, climbs: 8, steps: 160, seed });
  const r = res.best.cheapest.r;
  console.log(`seed ${seed}: $${r.lcc.toFixed(1)}M compliant=${r.compliant} (${res.evaluated} designs)`);
  if (r.compliant && (!best || objective('cheapest', r) > objective('cheapest', best))) best = r;
}
// Polish: one-at-a-time sweep of every lever and choice from the best design until nothing cheaper still passes.
const { ELEMENTS } = await import('../src/sdr/catalog.js');
let d = structuredClone(best.design), improved = true;
const tryD = c => { const r = evaluateDesign(ctx, c); return r.compliant && objective('cheapest', r) > objective('cheapest', evaluateDesign(ctx, d)) ? c : null; };
while (improved) {
  improved = false;
  const cands = [];
  for (let n = 2; n <= 200; n += 1) cands.push({ ...d, n });
  for (let k = 0; k <= 300; k += 5) cands.push({ ...d, repeaters: k });
  for (const v of [1, 2, 3, 4]) cands.push({ ...d, dbNodes: v });
  for (const v of [12, 18, 24, 36]) cands.push({ ...d, leoSats: v });
  for (const v of [false, true]) cands.push({ ...d, raised: v });
  for (const v of [0, 1]) cands.push({ ...d, sparesPerPlane: v });
  for (const e of ELEMENTS) for (const o of e.options) cands.push({ ...d, pick: { ...d.pick, [e.id]: o.id } });
  for (const c of cands) { const ok = tryD(c); if (ok) { d = ok; improved = true; } }
}
const r = evaluateDesign(ctx, d, { withFails: true });
const out = {
  ...d,
  name: 'Bare minimum (meets every requirement)',
  notes: `The cheapest design that meets every Level 0 requirement (S3-01 to S3-10) and the $400M cap, found by scripts/bare-minimum.mjs on ${new Date().toISOString().slice(0, 10)}: $${r.lcc.toFixed(1)}M over 15 years (range $${r.total.low.toFixed(0)}-${r.total.high.toFixed(0)}M), staff not counted (team rule). Tightest requirement: ${r.tight.id} at ${(r.tight.margin * 100).toFixed(0)}% margin. Every margin is thin by design: this is the floor every other design is compared against.`,
};
fs.writeFileSync(new URL('../designs/bare-minimum.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('\nBare minimum:', `$${r.lcc.toFixed(1)}M (${r.total.low.toFixed(0)}-${r.total.high.toFixed(0)})`, JSON.stringify({ n: d.n, repeaters: d.repeaters, dbNodes: d.dbNodes, leoSats: d.leoSats, raised: d.raised, spares: d.sparesPerPlane, ...d.pick }));
for (const c of r.checks) console.log(`  ${c.id.padEnd(6)} ${c.state.padEnd(5)} margin ${(c.margin * 100).toFixed(0).padStart(4)}%  ${c.v}`);
console.log('  lines', r.lines.map(l => `${l.name}: ${l.base.toFixed(1)}`).join(' | '));
console.log('  staff (not in total)', r.staff.total15.toFixed(1), 'resilience', r.criteria.resilience.toFixed(2), 'fails', r.fails.map(f => `${f.f}:${f.failed?.join(',') || 'ok'}`).join(' '));
