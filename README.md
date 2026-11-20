# Congo River Basin SDR: RFP S-3 BASINLINK & BASINCAST

The System Definition Review site for **RFP S-3** (space-based communications for sensors, responders and
communities): the concept from the SRR, now designed with real equipment, link budgets, a 15-year cost by year,
a design-space search and sensitivity analysis. Flooding is the worked example; the same comms layer serves every hazard.

**Live:** https://corrigk.github.io/congo-river-basin-SDR/ · **SDR workbench:** https://corrigk.github.io/congo-river-basin-SDR/#sdr

**The SRR version** (frozen as reviewed) stays at https://corrigk.github.io/congo-river-basin-SRR/ (repo
[congo-river-basin-SRR](https://github.com/corrigk/congo-river-basin-SRR)); this repo was copied from it with its full
history. Requirements are edited on the separate requirements site
([congo-srr-requirements](https://github.com/corrigk/congo-srr-requirements)).

It is a concept visualization, not a live system. Requirement text and numbers are verbatim from the RFP (Appendix A
of `docs/brief-v2.md`). Everything else carries a visible label on the page: **Assumption**, **Modeled proxy**,
**Proposed allocation, TBR**, **Notional baseline, trade study pending**, or, in the SDR workbench, **Published**,
**Estimate** and **SRR assumption** with a source. The Sources drawer (**S**) lists every citation.

## Tabs

| Tab | What it shows |
| --- | --- |
| **Research** (front page) | Where things happen and what exists. **Why**: population density, conflict (UCDP), fire (NASA FIRMS), floods (GDACS), protected areas and existing infrastructure, with sourced figures. **Today** (→): the same map without S-3: who existing networks reach (a modeled proxy around the towns we hold) and the RFP's figures (3–7 days for field data, 62% with no warning, 13–15 river gauges). Coming next (brief v3): the existing-infrastructure map (power, roads, rivers, cell sites, mountable structures) and the gap table |
| **Design** | **S-3 system**: what S-3 builds, where, and how many: people within a station's reach, ranger stations, canopy repeaters, sensors, database nodes, the GEO alert footprint; sliders and toggles drive live **requirement checks** (S3-01 to S3-10 and the $400M cap), counts and the cost range; a **vs Today** tab. **Who must hear it**: what "covered" means (audible, alert time, ranger reach), how S3-05 counts village speakers as receivers, who counts (rural + peri-urban 179M of 222.7M), the four ways to make the sound, and the scale check. **How far a voice carries**: the acoustic model, live, with the sound profile out of a village into forest. See [docs/coverage-model.md](docs/coverage-model.md). Coming next (brief v3): where speakers go, stations from speakers, ranger reach and the sensor risk map |
| **Trades** | The decision workbench. It opens on the **bare minimum**: the cheapest design that meets every requirement (`designs/bare-minimum.json`, found by `node scripts/bare-minimum.mjs`), which every other design is compared against. Configure the system with catalog equipment (sourced, labelled options for every element), link budgets and power sizing, the 15-year cost by year, requirement margins and failure cases, team-weighted ranking (winner map, flip points, robustness, decision log), the design-space search (Pareto cloud) and sensitivity (tornado, elasticity, Monte Carlo). **Present ▸** turns a design into a seven-slide deck; every chart exports as PNG or SVG. See [docs/sdr-workbench.md](docs/sdr-workbench.md) |

The requirements themselves are on the team's [requirements site](https://corrigk.github.io/congo-srr-requirements/)
(**Requirements ↗** in the top bar). The RFP's Level 0 requirements still drive every check on this site
(`src/s3/content.js`).

**Staff costs** are left out of the 15-year total, as in the SRR (team rule). The Trades tab shows them on their own
line and has a switch to count them.

## Presenting

| Key | Action |
| --- | --- |
| 1 – 3 | Research · Design · Trades |
| → · PgDn · Space | Next step: Why → Today → S-3 system → Who must hear it → How far a voice carries (clickers work); in a Trades deck, next slide |
| ← · PgUp | Previous step or slide |
| P | Presenter mode: larger type, higher contrast, no keyboard hints (remembered) |
| H | Slide mode: hides the top bar so the page fills the screen for a screenshot (H again, or the corner button, to undo) |
| L | Light / dark theme (follows the system setting until you pick one; remembered) |
| S | Sources drawer |
| F · ? | Fullscreen · shortcuts |
| Esc | Close a panel; leave a Trades deck |

**Deep links** open a view directly, so a slide can link straight to it: `…/#research`, `…/#research/today`,
`…/#design`, `…/#design/hear`, `…/#design/sound`, `…/#trades`, `…/#trades/present/3`. SRR-era links still land (`#conops…` → Research or Design,
`#sdr…` → Trades). Add `?present` for presenter mode and `?slide` for slide mode. Laid out for 1280×720 and up
(also 1024 px and phone width).

**Screenshots for slides:** open the view, press **F** (fullscreen) and **H** (slide mode), then take the screenshot.
On a 1920×1080 or 1280×720 screen the result is 16:9.

**Before presenting on a computer you don't control:** open the page once and wait for the badge in the top bar to
read **Ready offline** (a few seconds; about 3.5 MB). After that every tab works with no network. If anything goes
wrong, `sdr-offline.html` is one file with the whole page inside (about 3.7 MB): copy it to a USB stick and
double-click it (the Trades optimizer and Monte Carlo need the online or served page: they run in a worker file).

## Run it locally

Node 20+.

```bash
npm install
npm run dev            # http://localhost:5173 (no service worker in dev)
```

Production build and a local copy of the GitHub Pages setup:

```bash
npm run build          # dist/ (site + sw.js) and sdr-offline.html
npm run serve          # http://localhost:4180/congo-river-basin-SDR/
node scripts/serve.mjs --port 4181 --kbps 400 --latency 400   # imitate bad Wi-Fi
```

Stop the server to imitate "network gone". Use a new port for a clean test: each port is its own origin with its own
offline cache. Opening `dist/index.html` from disk does not work (browsers block ES modules over `file://`); use
`sdr-offline.html` for that. Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Rerun the analysis pipeline

The numbers on the Research and Design tabs come from the Python pipeline in `analysis/` (inputs, commands,
the hazard downloads and the real-data rerun notes are in [analysis/README.md](analysis/README.md)). After a rerun,
rebuild the files the page loads and check the model:

```bash
npm run data:page                  # analysis/data -> src/s3/v2/data (core, geo, grid, pop-<year>, stations-<year>, hazards)
node scripts/conops-report.mjs     # the ConOps model on the new data: baseline, levers, failure cases, sweet spot
node scripts/sdr-report.mjs --opt  # the SDR engine: baseline, each catalog option, the optimizer's best designs
node scripts/bare-minimum.mjs      # re-find the bare-minimum design (about 2 min) -> designs/bare-minimum.json
node scripts/coverage-report.mjs   # every number on the Design tab's alerting-chain steps
```

The page loads only the files a view needs, so the first paint stays small. The station slider defaults to the sweet
spot of the chosen year. Commit both `analysis/data` and `src/s3/v2/data`, and update the figures quoted in
`docs/conops-model.md` from the report.

## Edit assumptions and requirements

- **ConOps assumptions** (Research and Design): `src/s3/conops/model.js` (`ASSUME`: relay reach, canopy shares,
  satellite capacity, unit costs and ranges). The page and `scripts/conops-report.mjs` both read it.
- **Equipment, prices and physics** (Trades): `src/sdr/catalog.js` (options, sources, basis labels) and
  `src/sdr/physics.js` (link budgets, rain, power sizing). Rerun `node scripts/bare-minimum.mjs` after a change that
  could move the cheapest compliant design.
- **Level 0 requirements, objectives, gap facts**: `src/s3/content.js`, the single source of truth for every RFP
  number on the page. Copy text exactly from the RFP. The team's decomposition lives on the requirements site.

## How the offline cache works

- **First visit.** The page renders from one HTML, one JS and one CSS file plus fonts. All libraries and fonts are
  self-hosted; nothing loads from a CDN, and nothing needs WebGL.
- **Service worker** (`dist/sw.js`, generated from `scripts/sw-template.js` by `scripts/sw-plugin.mjs` with the list
  of files the build produced):
  - on install it caches everything: the page, every tab's code, the Trades worker and all map data for every year
    (about 3.5 MB), so a second visit works offline on every tab;
  - files are served cache-first; the page itself is served from cache and refreshed in the background, so a new
    deploy shows up on the next reload. A new build (or a change to the worker itself) gets a new cache and the
    old one is deleted;
  - caches are named `sdr-…`: the SRR site shares the `corrigk.github.io` origin and uses `srr-…`, and each worker
    deletes only its own, so the two sites never clear each other's offline copy;
  - `sw.js` is never cached: the page fetches it to tell whether the server is reachable at all;
  - only the site itself is answered with the cached page, so `sdr-offline.html` loads as itself.
- **Badge** (top bar): *Loading…* → *Ready offline*.

## Themes and accessibility

Dark is the default; light follows the system setting or **L**. Colours are tokens in `src/style.css` (site) and
`src/s3/v2/v2.css` (charts and map ramps, from the brief's prototype). Text meets WCAG AA contrast in both themes; everything works by keyboard (on the ConOps
map, the number of database nodes is set with buttons; moving a node to another city is a mouse click); charts have table views and the maps have text descriptions.

## Code map

- `src/main.js`: state, routing, the three tabs and the Research → Design story, keyboard, theme, presenter and slide modes
- `src/s3/steps.js`: the Research and Design steps in story order, and which view draws each
- `src/s3/coverage/`: the alerting chain: `view.js` (Who must hear it, How far a voice carries), `acoustics.js` (the sound model)
- `src/s3/conops/`: the Research and Design map view: `view.js` (layout, controls, results), `map.js` (the stepped
  map), `model.js` (the formulas behind the checks and the cost range)
- `src/s3/v2/`: `ui.js` (charts, controls), `data.js` (loaders), `data/` (page data built from `analysis/`)
- `src/s3/views.js`: Sources drawer and help; `src/s3/content.js`: RFP requirements and other fixed text;
  `src/s3/offline.js`: service worker registration and the badge
- `src/sdr/`: the Trades workbench (catalog, physics, engine, decide, optimize, sensitivity, export, worker, view);
  `designs/`: preset designs, including the bare minimum
- `analysis/`: data pipeline (Python); `scripts/`: page data, reports, bare-minimum search, service worker, test server
- `docs/conops-model.md`, `docs/coverage-model.md`, `docs/sdr-workbench.md`: how the numbers are worked out; `docs/sdr-plan.md`: the plan

## Data and licences

| Layer | Source |
| --- | --- |
| Basin outline | HydroSHEDS HydroBASINS (Lehner & Grill 2013) |
| Population | WorldPop 2020, 1 km, UN-adjusted (CC BY 4.0), projected with UN growth |
| Protected areas | UNEP-WCMC and IUCN, WDPA, October 2026 (**non-commercial use only**; cited on the page) |
| Today's network reach | **Modeled proxy**: a radius around each of 260 towns (GeoNames), by size; not measured coverage |
| Conflict | UCDP Georeferenced Event Dataset v25.1, 2015–2024 (CC BY 4.0) |
| Fire | NASA FIRMS MODIS C6.1 active fires, 2024, DR Congo |
| Floods | GDACS flood alerts since 2000 (EC JRC) |
| Rivers, roads, borders, places | Natural Earth (public domain), GeoNames |
| Online imagery | Esri World Imagery (no token); offline: Cesium's bundled Natural Earth II |

River-gauge sites are still a **modeled proxy** (rule-based) until the GRDC station list is obtained. Illegal mining
sites (IPIS) are not shown: the service could not be reached when the data was built. All other citations are in
`analysis/data/sources.json` and in the Sources drawer.

