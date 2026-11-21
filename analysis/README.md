# Analysis pipeline (brief v2)

The data behind the SRR page's six analysis sections: population, ranger-station siting, database siting,
LEO revisit, sensors, comms options and the 15-year budget. Scripts in `scripts/`, outputs in `data/`
(the page reads these). Imported from `congo-srr-package.zip`; the brief is in `../docs/brief-v2.md`.

## Inputs (not committed: `raw/` is git-ignored)

| Input | Where it goes | Get it from |
| --- | --- | --- |
| Natural Earth 10m GeoJSON (countries, rivers + lake centerlines, lakes, roads, populated places) | `raw/*.geojson` | `raw/README.txt` (public domain) |
| WorldPop 2020 1 km UN-adjusted, one GeoTIFF per country (COD COG CAF CMR AGO ZMB TZA BDI RWA GAB) | `raw/worldpop/` | `https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/<ISO3>/<iso3>_ppp_2020_1km_Aggregated_UNadj.tif` (CC BY 4.0) |
| WDPA per-country shapefiles (same 10 countries) | `raw/wdpa/` | `https://d1gam3xoknrgr2.cloudfront.net/current/WDPA_WDOECM_<Mon><YYYY>_Public_<ISO3>_shp.zip` (Protected Planet; **non-commercial terms of use**, cite as in `data/sources.json`) |
| Basin outline | already in the repo | `../src/data/basin.json` (HydroSHEDS HydroBASINS) |
| Conflict events (UCDP GED v25.1, CC BY 4.0) | `raw/hazards/ucdp/ged251-csv.zip` | `https://ucdp.uu.se/downloads/ged/ged251-csv.zip` (29 MB) |
| Active fires 2024, DR Congo (NASA FIRMS MODIS) | `raw/hazards/firms/` | `https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Democratic_Republic_of_the_Congo.csv` (41 MB) |
| GRID3 COD Settlement Extents v4.0 (CC BY-SA 4.0) | `raw/grid3/grid3_cod_settlement_extents_v4.gpkg` (912 MB) | `https://academiccommons.columbia.edu/doi/10.7916/n7b2-jd56/download` (DOI 10.7916/bb5b-9b79) |
| Flood alerts (GDACS, EC JRC) | `raw/hazards/gdacs/FL_<country>.json` | GDACS event-list API, one request per basin country (small; the service often times out, so retry) |

## Run it

Python 3.11+ (tested on 3.14). On Windows, set `PYTHONUTF8=1`: the scripts open files without naming an encoding.

```bash
cd analysis
python -m venv .venv
.venv/Scripts/python -m pip install numpy scipy shapely pyproj geonamescache rasterio pyshp
export PYTHONUTF8=1
PY=.venv/Scripts/python
$PY scripts/build_geography.py --basin ../src/data/basin.json --basin-name "HydroSHEDS HydroBASINS (level 6 catchments dissolved to the Congo basin; repo src/data/basin.json)"
$PY scripts/prep_wdpa.py                                  # needs basin.geojson from the step above
$PY scripts/build_population.py --worldpop raw/worldpop/*.tif
$PY scripts/optimize_stations.py                          # uses travel.py (grid, sites, travel graph); run without -I
$PY scripts/site_databases.py
$PY scripts/leo_revisit.py
$PY scripts/build_sensors_comms_budget.py                 # uses the WDPA polygons when raw/wdpa has them
$PY -I scripts/build_hazards.py                           # conflict, fire and flood layers for the ConOps 'why' map
$PY -I scripts/build_urbanisation.py                      # urban centres / peri-urban / rural (Degree of Urbanisation) for the Design tab
$PY scripts/build_settlements.py                          # GRID3 DRC settlement blocks -> raw/grid3/blocks.npz (needs the GeoPackage below)
$PY scripts/site_speakers.py                              # village speakers and receivers on real settlements (DRC), proxy elsewhere; hazard-first rollout
$PY scripts/fetch_pilot.py                                # Mbandaka pilot windows of Copernicus GLO-30 and ETH canopy height -> raw/pilot/ (range requests)
$PY scripts/pilot_profiles.py                             # 12 pilot speakers x 12 bearings over real terrain and canopy -> data/profiles_pilot.json
$PY scripts/stations_from_speakers.py                     # ranger stations derived from the speakers (X per station, 8 h trips)
$PY scripts/hubs_from_speakers.py                         # major and minor ranger hubs from the speakers (8 / 12 / 24 h to a minor hub)
```

Leave out `--basin`, `--worldpop` or the WDPA files to fall back to the original modeled proxies.

## Changes to the delivered scripts

- `build_geography.py`: `--basin-name` records where a supplied outline comes from; the "replace_with" hint is only
  written for the approximated outline.
- `build_population.py`: `--worldpop` takes several rasters (one per country) and sums them on the model grid.
  The method is unchanged: WorldPop gives the spatial pattern, UN national totals set each year's population.
- `prep_wdpa.py` (new): extracts nationally designated, designated / inscribed / established, non-marine
  protected-area polygons of at least 100 km² inside the basin (WDPA manual v1.6 field names).
- `build_sensors_comms_budget.py`: uses the WDPA polygons when present. Sensor placement keeps the same meaning
  ("inside", "edge" ring from 10 km inside to 20 km outside the boundary); `protected_areas.json` gains polygon
  geometry. Falls back to the 21 approximate centroids otherwise.

## Basin outline gaps filled, 2026-11-20 (SDR)

The dissolved HydroSHEDS outline had three interior rings, gaps between level-6 catchments rather than real holes: one
on Mbandaka (about 2,900 km², 221k people in WorldPop 2020) and one between Kinshasa and the Kwango (about 20,700 km²,
173k people). `build_geography.py` now fills them, and the whole pipeline was rerun: the basin gains 123 grid cells and
0.66M people in 2041 (222.0M → 222.7M), Mbandaka (455k) is back in `towns_raw.json`, receivers rise from 358,203 to
359,528 in 2041, and the station sweet spot is unchanged (78 stations, 40.6%, $36.6M). `build_urbanisation.py` (new)
splits the basin's people by the Degree of Urbanisation for the Design tab.

## Real-data rerun, 2026-10-26

Replaced: basin outline (HydroSHEDS), population (WorldPop 2020), protected areas (WDPA October 2026, 168 areas,
13.5% of the basin). **Still a proxy:** river gauge sites are rule-based (the GRDC station list needs a request
to GRDC). LEO revisit does not depend on these inputs and is unchanged.

| Result | Proxy (as delivered) | Real data |
| --- | --- | --- |
| Basin population 2026 / 2041 | 157.5M / 234.5M | 147.9M / 222.0M |
| Sweet spot, mix 2041 | 97 stations, 46.5% covered, $45.7M | **78 stations, 40.6%, $36.6M** |
| Coverage at 100 / 400 stations (mix 2041) | 46.8% / 69.3% | 44.0% / 66.1% |
| Sweet spot, radio 2041 | 101 stations, 48.5%, $49.0M | 74 stations, 41.5%, $36.0M |
| Sweet spot, 1-hour response 2041 | 105 stations, 33.8%, $50.2M | 82 stations, 29.3%, $38.5M |
| Loudspeaker coverage at 400 stations | 4.9% | 4.2% |
| Database nodes | Kinshasa, Mbuji-Mayi, Kisangani, Kalemie | **unchanged** |
| Mean distance to a node (4 nodes / Kinshasa only) | 354 km / 1,051 km | 359 km / 1,120 km |
| Bangui instead of Kisangani (Kinshasa, Bangui, Mbuji-Mayi, Kalemie) | about 8 km worse | about 2 km worse (361 km) |
| Community receivers 2026 → 2041 | 255k → 365k | 239k → 358k ($6.0M → $9.0M at $25) |
| 15-year total vs $400M cap | $400.7M (0.7M over) | **$391.4M (8.6M under)** |

Why the sweet spot moved: WorldPop puts more of the basin's people in and around cities and fewer in the
rural strips along rivers and roads where the proxy spread them. The first stations therefore cover people
faster and the curve flattens sooner, so the knee comes earlier. Coverage at a fixed 100 stations barely changes
(46.8% → 44.0%). The proxy also put far too many people in the parts of Rwanda (6.8M → 2.4M), Cameroon
(4.3M → 1.1M) and Angola (6.3M → 3.1M) that lie inside the basin.
