# The alerting chain: how the coverage numbers are worked out

The Design tab's alerting-chain steps, from brief v3 (`brief-v3-speakers-coverage.md`, kept in the team's SDR folder),
built in stages (see `docs/sdr-plan.md`). Code in `src/s3/coverage/`; every number below is printed by `node scripts/coverage-report.mjs`.

| Step | Link | Stage |
| --- | --- | --- |
| Who must hear it | `#design/hear` | 1 (done) |
| How far a voice carries | `#design/sound` | 1 (done; terrain profiles in Stage 3) |
| Where speakers go, device mix | | 3 |
| Existing infrastructure, the gap table | Research tab | 2, 4 |
| Who looks after them (stations from speakers), ranger reach | | 4 |
| Where sensors go | | 5 |

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
