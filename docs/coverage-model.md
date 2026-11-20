# The alerting chain: how the coverage numbers are worked out

The Design tab's alerting-chain steps, from brief v3 (`brief-v3-speakers-coverage.md`, kept in the team's SDR folder),
built in stages (see `docs/sdr-plan.md`). Code in `src/s3/coverage/`; every number below is printed by `node scripts/coverage-report.mjs`.

## The chain on the map

Research and Design are one story on one map (`src/s3/steps.js`; → walks it, clickers work). Each step keeps the one
before it faintly on the map and animates the new layer in, so the links are visible:

| Step | Link | What feeds it | What it shows |
| --- | --- | --- | --- |
| Why | `#research` | | People, conflict, fire, floods, protected areas, infrastructure |
| Today | `#research/today` | | Who existing networks reach (modeled proxy) |
| Speakers & receivers | `#design` | People (where they cluster) and the Why map's hazards (rollout order) | Village speakers, receivers, urban centres; speakers fade in hazard-first |
| Ranger stations | `#design/stations` | The speakers: each station looks after up to X within an 8-hour trip | Stations, each speaker area wired to its station, the SRR's 78 for comparison; crew-hours calculator |
| What's at a station | `#design/kit` | The stations and the speakers they look after | Main stations and waypoint posts on the map; the station's parts, comms, power, crews, visits and 15-year cost |
| S-3 network | `#design/network` | The speaker-driven stations ("Speakers" mode of the station slider) | Satellites, GEO footprint, hubs, data flow (stations ↔ nodes ↔ hub, alerts down), checks and cost |
| Who must hear it · How far a voice carries | `#design/hear`, `#design/sound` | | Explainers, opened from the speakers step |

| Coverage stage | Status |
| --- | --- |
| 1: definitions, acoustics | done |
| Chain on the map (speakers → stations → network) | done |
| What's at a station (station design) | done |
| 3: settlements (GRID3, DRC) and speaker siting on real villages | done |
| 3: pilot terrain and canopy profiles (Copernicus DEM, ETH canopy); other countries' settlements | next |
| 2: existing infrastructure; 4: gap classes, travel grid, ranger reach | after 3 |
| 5: sensor risk map; 6: Trades integration, offline, run-through | after |

## Decisions (team, 2026-11-20)

- **S3-05 as written.** It counts receivers: "≤10 min for ≥95% of receivers". Every village speaker carries the same
  GEO receiver as the $25 community receiver, so **each village speaker counts as an S3-05 receiver**. How many
  *people* can hear an alert is reported as information, with 95% as a reference line, not as a requirement
  (draft TD-AUD-01 not adopted).
- **Design population: rural plus towns and peri-urban** (outside urban centres of 50k+). All residents are reported
  too; the ranger-served area comes with the stations (Stage 4).
- **Who maintains what:** rangers keep the station tower (T0) and village speakers (T1); communities and health workers
  keep the $25 receivers (T2).
- **Ranger reach** is reported as curves (30 min, 1 h, 4 h, 24 h), with no target yet.

## Three different "covered"

| Measure | What it is | Driven by |
| --- | --- | --- |
| **Audible** | Share of people where a speaker's voice is at least 10 dB above the background noise | Speaker sites, terrain, forest, noise |
| **Alert time** | Share of receivers sounding within 10 min of the authorized alert (S3-05) | GEO broadcast, processing, playback |
| **Ranger reach** | Share of people a ranger can physically reach within a given time | Stations, boats, roads, foot |

People who hear a warning in time ≈ audible × alert time. Audibility is the binding limit: no satellite speed helps
someone standing where no voice carries.

## Who counts

A simplified **Degree of Urbanisation** (UN Statistical Commission 2020) on WorldPop 2020 1 km inside the basin
(`analysis/scripts/build_urbanisation.py` → `analysis/data/urbanisation.json`):

- urban centre: contiguous 1 km cells of ≥1,500 people/km² adding up to ≥50,000 people;
- town or peri-urban cluster: contiguous cells of ≥300 people/km² adding up to ≥5,000, not in a centre;
- rural: the rest.

2020 shares: urban centres **19.6%** (33 centres), towns and peri-urban **21.7%**, rural **58.7%**. Held constant to
2041 (assumption; cities grow faster, so the urban share is understated): **222.7M** in all, **179.0M** rural plus
peri-urban (the design population), **43.7M** in urban centres. Labelled **Modeled proxy**.

## How far a voice carries

```
L(r) = L_src(100 ft) − D · log2(r / 30.48 m) − air · (r − 30.48 m) − forest · (r − clearing)    (last term beyond the clearing)
heard where L(r) ≥ ambient + 10 dB (+ building loss indoors)
```

Parameters and their sources are in `analysis/data/acoustic_params.json` (brief Appendix A); all can be changed on
the page.

| Parameter | Low | Base | High | Basis |
| --- | --- | --- | --- | --- |
| Village speaker (T1) at 100 ft | 110 | 116 | 120 dB | Assumption (MOD5020 class is 120) |
| Station tower array (T0) at 100 ft | 120 | 124 | 124 dB | Cost model, Federal Signal class |
| Loss per doubling, land | 6 | 8 | 10 dB | FEMA (soft ground) to vendor rule |
| Loss per doubling, over water | 3 | 4 | 6 dB | FEMA |
| Air absorption, 1 kHz, hot and humid | 3 | 5 | 7 dB/km | Assumption from ISO 9613-1 tables |
| Forest, voice band | 2 | 6.6 | 20 dB/100 m | Rainforest measurement (1.9), FEMA woods (6.6), older tropical work (20) |
| Background noise, village by day | 40 | 45 | 50 dBA | Assumption, to measure |
| Background noise, forest edge at night | 50 | 55 | 60 dBA | Assumption, to measure (design case) |
| Margin above background | 10 | 10 | 15 dB | FEMA |
| Building loss, windows open / closed | 12 | 12 / 22 | 25 dB | FEMA Table 3 |
| Village clearing radius | 150 | 300 | 600 m | Assumption (per settlement in Stage 3) |

Thresholds: outdoors by day **55 dB**, outdoors at night **65 dB** (the design case: floods and attacks come at
night, and insects make the forest edge loudest then), indoors with windows open **77 dB**.

**Check against the brief (§5.3):** with the tower array (124 dB), 10 dB per doubling, 5 dB/km of air and a 300 m
clearing, the model reproduces the brief's table exactly; at 70 dB: 0.94 km open, 2.93 km at 6 dB per doubling,
then 0.64 / 0.48 / 0.44 / 0.38 km for 2 / 6.6 / 10 / 20 dB of forest per 100 m. The page shows this table under
**Check**.

**A village speaker at night (base values):** **534 m** out of a 300 m clearing into forest (0.90 km²), 1.4 km over
open ground, 4.5 km along a river; **372–889 m** into forest across the range. Once the voice leaves the clearing the
forest takes it within a few hundred metres: **one speaker covers one village, not a region**, and riverside speakers
carry much farther along the water.

Not yet modelled: terrain shadowing (up to 20 dB when the line of sight is blocked) and the real canopy height along
each path. Both need the Copernicus GLO-30 surface model and the ETH canopy-height map (pilot tiles, Stage 3), which
also give the per-bearing sound profiles. Speech intelligibility (STI) is a test-phase item; the level-based proxy
stands in for SDR.

## The scale check

- Rural people in 2041 (the community-receiver model): **175.0M**, so about **350k villages** of about 500 people
  (one $25 receiver each today: 359,528).
- One village speaker in every village: **≈350k speakers**: **4,487 per station** with the SRR's 78 stations, or
  175k each with the bare minimum's 2.
- Installed at $1,500–6,000 each (assumption, before vendor quotes): **$0.5–2.1B**, against the $400M cap for the
  whole system.

So the answer is a **mix**: village speakers where people cluster (larger villages, towns, river ports, markets,
mining camps), $25 receivers for the long tail of hamlets, phones where towers already reach. Stage 3 counts it from
settlement data: the 1 km population grid has 2.1M settled cells outside the 33 urban centres and cannot tell a
village from scattered homes. GRID3 settlements cover the DRC and Republic of Congo, 79% of the basin's people.

## Team-derived drafts (TBR)

| ID | Draft | Status |
| --- | --- | --- |
| TD-AUD-02 | Every outdoor speaker is fed by the S-3 broadcast path, so it counts toward S3-05 | Adopted as the S3-05 framing |
| TD-AUD-03 | Every speaker reports "played" within the S3-09 window | Draft |
| TD-STA-01 | Every speaker is assigned to a station that can reach it within T_maint (8 h, TBR) | Draft (Stage 4) |
| TD-STA-02 | No station looks after more than X speakers (crew-hours calculator) | Draft (Stage 4) |
| TD-REACH-01 | Ranger reach reported as curves, no target yet | Curves only |
| TD-SEN-01 | Highest-risk zones have under-canopy detection with a relay path meeting S3-03 | Draft (Stage 5) |
| TD-AUD-01 | Voice alerts audible to ≥95% of people | Not adopted |

## Data fix in this stage: the basin outline had holes

The HydroSHEDS outline (dissolved from level-6 catchments) had three interior rings: gaps between catchments, not
real holes. One sat on **Mbandaka** (2,900 km², about 221k people in WorldPop 2020) and one between Kinshasa and the
Kwango (20,700 km², about 173k). The population grid, stations and towns all left those people out, and Mbandaka (the
proposed pilot area) was missing from the towns list. `build_geography.py` now fills interior gaps and the pipeline was
rerun: the basin gained 123 grid cells and **0.66M people** in 2041 (222.0M → 222.7M); the station sweet spot is
unchanged (78 stations, 40.6%, $36.6M), and Mbandaka (455k) is back in the towns list.

## Speakers and receivers (Stage 3: real settlements in the DRC)

**Settlements.** `analysis/scripts/build_settlements.py` reads GRID3 COD Settlement Extents v4.0 (CIESIN / GRID3,
July 2026, CC BY-SA 4.0; `raw/grid3/grid3_cod_settlement_extents_v4.gpkg`, 912 MB, downloaded 2026-11-20 from
Columbia Academic Commons, DOI 10.7916/bb5b-9b79, not committed): 1,152,927 settlement blocks with building counts,
1,084,318 inside the basin. GRID3 has no population, so people per block = buildings × people per building, calibrated
per grid cell: each DRC cell's WorldPop 2020 people are shared among its buildings, capped at 15 per building
(assumption), the rest counted as living outside the mapped settlements. Calibrating per 14 km cell matters: sharing
per 1 km pixel left half the DRC's people in pixels with no block, because WorldPop spreads people smoothly while GRID3
puts them at the buildings. Result: 82.0M of the DRC's 85.9M people (2020) in blocks, 5.5M outside, a median of 5.7
people per building (DRC households average about 5). Built-up blocks hold 34.6M, small settlement areas 36.6M, hamlets
10.8M.

**Speakers.** `analysis/scripts/site_speakers.py`. In the DRC a speaker covers every block whose centre is within its
voice radius (534 m at night out of a 300 m clearing; terrain comes with the pilot DEM); built-up blocks larger than one
speaker's area get several; greedy maximum coverage places the speaker reaching the most people still uncovered, down to
150 people. Blocks left over get a receiver each (at least 10 people; one per 500 beyond), and people outside the mapped
settlements one per 500. Outside the DRC (24% of the basin's people) the WorldPop proxy stays until those countries'
settlement data is added (GRID3 Republic of Congo; Google Open Buildings elsewhere). Urban centres rely on phones and
radio first.

**Informed by the Why map:** speakers roll out in order of people heard per speaker × (1 + hazard score), the hazard
score per grid cell being the mean of conflict deaths 2015–2024, fire detections 2024 and GDACS flood alerts within
50 km, each log-scaled to 0–1 (equal weights). The first tenth of the rollout sits at a mean hazard of 0.32 against
0.21 for all speakers.

2041, base values: **147,077 village speakers** reaching **138.2M people (77.2% of the 179.0M rural and peri-urban)**;
**277,202 receivers** for 41.6M people in hamlets and outside the mapped settlements; 43.7M people in urban centres.
Range **79k–355k speakers** (voice 889 m with a 300-person cutoff: 72.8%; 372 m with a 50-person cutoff: 81.7%). By
year: 110k (2026), 122k, 135k, 147k (2041). S3-05 counts every speaker and receiver as a receiver: about 424k in 2041.

The proxy (people spread evenly in each 1 km pixel) had given 235k speakers reaching 54%: real villages are compact,
so one speaker reaches far more people.

## Ranger stations derived from the speakers

`analysis/scripts/stations_from_speakers.py` → `analysis/data/stations_speaker.json`, on the SRR's candidate sites and
travel model (`analysis/scripts/travel.py`, shared with `optimize_stations.py`). Rangers keep the village speakers
(team decision). Each station looks after at most **X = crews × hours a year ÷ (visits a year × hours a visit)** speakers
within an **8-hour trip** (`analysis/data/maintenance_params.json`, all assumptions TBR: 2 crews × 1,600 h ÷ (2 visits ×
6 h) = **266**). Greedy capacitated cover: open the site that can take the most unassigned speakers, give it the nearest
ones up to X, repeat; a site can hold more than one station.

Result (GRID3 speakers): **1,061 stations at 931 sites** for 123,664 speakers; **23,413 speakers have no candidate site
within 8 h**. Every one costed as a full SRR station, they reach 64.7% of people by radio or a 1-hour response and cost
**$527M over 15 years**. With fewer but more spread-out speakers, reach rather than crew capacity sets the count. The
trade table (stations needed):

| X | 4 h | 8 h | 24 h |
| --- | --- | --- | --- |
| 50 | 2,775 | 2,877 | 2,954 |
| 100 | 1,819 | 1,706 | 1,531 |
| 200 | 1,389 | 1,180 | 826 |
| 266 | 1,281 | 1,061 | 654 |
| 400 | 1,214 | 934 | 480 |
| 1,000 | 1,139 | 846 | 305 |
| 2,000 | 1,128 | 815 | 248 |

The S-3 network step uses these stations as the **Speakers** mode of its station slider: with the station design the 15-year
cost is about $575M (stations $212M of it); the slider (or the Mix mode) shows the cost-constrained versions side by side, as the team chose.
Fewer speakers per village (settlement outlines), more speakers per crew, or communities keeping the smaller speakers
are the levers; Stage 3 and 4 will move all of these numbers.

## What's at a station: the station design (`#design/kit`)

`src/s3/coverage/stationkit.js`, catalog `analysis/data/station_kit.json` (every figure labelled srr, published or
estimate). The SRR costed every site as a full station ($444–646k over 15 years each, so the 1,037 derived sites came
to $512M). Most of those sites only exist to service nearby speakers, so the design has two kinds of site:

- **Main station**: building (prefab / containers / shared), tower (30 / 24 / 12 m), station loudspeaker (3.2 kW /
  600 W / none), radios (VHF repeater + handhelds / handhelds), backhaul (Starlink about 100 down / 15 up Mbps, VHF-sat
  10 / 2, or the S-3 terminal only), the S-3 responder terminal, the medical and spares kit, and solar plus LiFePO4
  sized to the loads (same method as the Trades physics). Crews (default 2 × 3 people) with a boat at river sites or
  motorbikes elsewhere.
- **Waypoint post**: 15 m mast, small solar, relay radio, locked shelter for spares and an overnight stop (about $16.5k,
  estimate). With posts, crews run circuits of up to 24 h instead of 8-hour day trips, and a circuit three times
  longer strings three times the stops (assumption, adjustable through "speakers per round").

**Capacity:** X = crews × crew hours a year ÷ (visits per speaker a year × (hours on site + 2 × one-way trip ÷
speakers per round)). The one-way trip comes from the speaker-to-station derivation at that X (a few fixed-point
steps); visits = routine (default 1 a year) + repairs (0.3 a year: with health telemetry crews go on a fault).

**How many:** main stations = the derivation's station count at this X for 24 h circuits (posts on) or 8 h day trips;
posts = the day-trip count minus the circuit count (the stations that circuits replace), placed at the remaining
derived sites. Main stations take the first sites of the derivation order (an approximation for X other than 266).

**Cost, 15 years:** parts and vehicles × the site's logistics multiplier (road 1.15, river 1.3, remote 1.6), plus 6%
of capex a year maintenance, backhaul subscription and rent, battery swaps (8 years), vehicle replacement (boat 6
years, motorbikes 5), and fuel for the motorised share of every round (default half the trip time; boat 0.6 L/km, two
motorbikes 0.035 L/km, $1.70/L: estimates). Crew salaries (default $3k a person a year, estimate) are shown, not
counted (team rule).

**Default design (GRID3 speakers):** X = 679 speakers per station, **360 main stations + 516 waypoint posts, about
$212M** (main stations about $553k each over 15 years on average; river sites cost most because of boat fuel). With
two-container buildings, a 12 m mast and a 600 W station speaker: $132M. With posts off: 866 stations, $450M. The SRR's
way of working (2 routine visits a speaker, one speaker per trip, no posts) needs about 1,540 stations and $686M.

In the S-3 network step, the "Speakers" station mode uses this design: its station line becomes "Ranger stations (N)
+ waypoint posts (M)" at this cost, and the station count follows the design's main stations.

Later: an animation of a crew's rounds through the forest over a week, a month and a year (team request).
