"""
Where village speakers and community receivers go (brief v3 §7), as a MODELED PROXY on WorldPop 2020 1 km until the
GRID3 settlement data replaces it (Stage 3; same output, no page change).

Per 1 km pixel inside the basin, outside the urban centres (build_urbanisation.py):
  heard by one speaker   people x min(1, A / pixel area), A = area a village speaker's voice reaches at night (the
                         acoustic model, acoustic_params.json base values: about 534 m out of a 300 m clearing)
  village speakers (T1)  as many as cover the pixel, each still hearing at least the cutoff (150 people);
                         none where even one speaker would hear fewer than the cutoff
  receivers (T2)         one per 500 people where no speaker goes (the community-receiver rule)
  urban centres          phones and radio first (T3); not sited here
Assumes people spread evenly within a pixel, so it undercounts how many one speaker hears in a compact village
(and overcounts speakers in towns): the reason Stage 3 uses settlement outlines.

Rollout priority comes from the Why map: people heard x (1 + hazard score), where the hazard score per grid cell is
the mean of conflict deaths 2015-2024 (UCDP), fire detections 2024 (FIRMS) and flood alerts within 50 km (GDACS),
each log-scaled to 0..1 (equal weights, adjustable later). Speakers in high-hazard, crowded places come first.

Outputs data/speakers.json: per grid cell (population.json order) for the design year, totals per year, the rollout
curve (speakers against people who can hear one) and the low / high bands.
"""
import json, os, math
import numpy as np
from build_urbanisation import load_worldpop, classify

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
YEAR = "2041"


def load(name):
    return json.load(open(os.path.join(DATA, name)))


AP = load("acoustic_params.json")["params"]
R0 = load("acoustic_params.json")["r0_m"]


def village_radius(band="base"):
    """Same model as src/s3/coverage/acoustics.js: night threshold, out of the clearing into forest."""
    v = lambda k, b=band: AP[k][b]
    b_src = {"low": "low", "base": "base", "high": "high"}[band]
    b_for = {"low": "high", "base": "base", "high": "low"}[band]  # a low radius has the most forest loss
    L0, D, air = AP["src_t1_db"][b_src], AP["d_land_db"]["base"], AP["air_db_km"]["base"]
    forest, clear = AP["forest_db_100m"][b_for], AP["clearing_m"]["base"]
    thr = AP["ambient_night_dba"]["base"] + AP["margin_db"]["base"]
    def level(r):
        r = max(r, R0)
        return L0 - D * math.log2(r / R0) - air * (r - R0) / 1000 - (forest * (r - clear) / 100 if r > clear else 0)
    lo, hi = R0, 20000.0
    for _ in range(60):
        m = (lo + hi) / 2
        lo, hi = (m, hi) if level(m) >= thr else (lo, m)
    return lo


def site(pop, pix_km2, area_km2, cutoff):
    """Speakers per pixel and the people they hear (evenly spread people)."""
    per_one = pop * np.minimum(1.0, area_km2 / pix_km2)
    need = np.ceil(pix_km2 / area_km2)                       # speakers to cover the whole pixel
    n = np.where(per_one >= cutoff, np.maximum(1, np.minimum(need, np.floor(pop / cutoff))), 0)
    heard = pop * np.minimum(1.0, n * area_km2 / pix_km2)
    return n, heard


def main():
    P = load("population.json")
    U = load("urbanisation.json")
    H = load("hazards.json")
    nx, res, lon0, lat0 = P["nx"], P["res_deg"], P["lon0"], P["lat0"]
    cells = np.array(P["cells"]["i"])
    pos = {int(g): k for k, g in enumerate(cells)}
    ncell = len(cells)

    # ----- hazard score per grid cell (the Why map) -----
    def norm(x):
        x = np.log1p(np.asarray(x, float))
        top = np.percentile(x[x > 0], 99) if (x > 0).any() else 1
        return np.clip(x / top, 0, 1)
    conflict, fire, flood = np.zeros(ncell), np.zeros(ncell), np.zeros(ncell)
    for g, (ev, deaths) in H["conflict"]["cells"].items():
        if int(g) in pos: conflict[pos[int(g)]] = deaths
    for g, c in H["fires"]["cells"].items():
        if int(g) in pos: fire[pos[int(g)]] = c
    clon = lon0 + (cells % nx) * res
    clat = lat0 + (cells // nx) * res
    for e in H["floods"]["events"]:
        dkm = np.hypot((clon - e["lon"]) * 111.32 * np.cos(np.radians(clat)), (clat - e["lat"]) * 110.57)
        flood += dkm <= 50
    hz = {"conflict": norm(conflict), "fire": norm(fire), "flood": norm(flood)}
    score = (hz["conflict"] + hz["fire"] + hz["flood"]) / 3

    # ----- pixels -> grid cells -----
    a, tr, km2 = load_worldpop()
    centre, cluster, *_ = classify(a, km2)
    rows, cols = np.nonzero(a > 0)
    plon, plat = tr * (cols + 0.5, rows + 0.5)
    gi = np.floor((plat - lat0 + res / 2) / res).astype(int) * nx + np.floor((plon - lon0 + res / 2) / res).astype(int)
    kcell = np.array([pos.get(int(g), -1) for g in gi])
    keep = kcell >= 0
    pop20, pk, cen, kc = a[rows, cols][keep], km2[rows, cols][keep], centre[rows, cols][keep], kcell[keep]
    wp_total = a.sum()

    r = {b: village_radius(b) for b in ("low", "base", "high")}
    area = {b: math.pi * (r[b] / 1000) ** 2 for b in r}
    cut = {b: AP["t1_cutoff_people"][b] for b in ("low", "base", "high")}
    per_village = AP["people_per_village"]["base"]

    years = {}
    for y in P["years"]:
        y = str(y)
        f = float(np.sum(P["pop"][y])) / wp_total             # WorldPop 2020 pattern scaled to each year's total
        pop = pop20 * f
        n, heard = site(pop, pk, area["base"], cut["base"])
        n[cen] = 0; heard[cen] = 0
        t2pop = np.where((n == 0) & ~cen, pop, 0)
        design = U["by_year"][y]["town_periurban"] + U["by_year"][y]["rural"]
        years[y] = {"t1": int(n.sum()), "t1_heard": int(heard.sum()), "t2": int(round(t2pop.sum() / per_village)),
                    "t2_pop": int(t2pop.sum()), "urban_pop": int(pop[cen].sum()), "design_pop": int(design),
                    "t1_heard_pct": round(float(heard.sum() / design * 100), 1)}
        if y == YEAR:
            # per cell, design year
            c_t1 = np.bincount(kc, weights=n, minlength=ncell)
            c_heard = np.bincount(kc, weights=heard, minlength=ncell)
            c_t2 = np.bincount(kc, weights=t2pop, minlength=ncell) / per_village
            c_urban = np.bincount(kc, weights=np.where(cen, pop, 0), minlength=ncell)
            # rollout curve: speaker pixels in priority order (people heard x (1 + hazard))
            sel = n > 0
            pr = heard[sel] / n[sel] * (1 + score[kc[sel]])
            order = np.argsort(-pr)
            cum_n = np.cumsum(n[sel][order]); cum_h = np.cumsum(heard[sel][order])
            marks = sorted(set([int(x) for x in np.unique(np.round(np.geomspace(100, max(cum_n[-1], 101), 40)))]))
            curve = {"n": [], "pct": []}
            for m in marks:
                j = min(len(cum_n) - 1, int(np.searchsorted(cum_n, m)))
                curve["n"].append(int(cum_n[j])); curve["pct"].append(round(float(cum_h[j] / design * 100), 2))
            # hazard share of the first speakers: where the first 10% of the rollout goes
            first = order[: max(1, len(order) // 10)]
            bands = {}
            for b in ("low", "high"):
                nb, hb = site(pop, pk, area[b], cut[b]); nb[cen] = 0; hb[cen] = 0
                bands[b] = {"radius_m": round(r[b]), "cutoff": cut[b], "t1": int(nb.sum()), "t1_heard_pct": round(float(hb.sum() / design * 100), 1)}
            cell_out = {
                "t1": np.round(c_t1).astype(int).tolist(),
                "heard": np.round(c_heard).astype(int).tolist(),
                "t2": np.round(c_t2, 1).tolist(),
                "urban": np.round(c_urban).astype(int).tolist(),
                "hazard": np.round(score, 3).tolist(),
            }
            first_hazard = float(np.mean(score[kc[sel]][first]))
            all_hazard = float(np.average(score[kc[sel]], weights=n[sel]))

    out = {
        "_note": "MODELED PROXY on WorldPop 2020 1 km (people spread evenly within each pixel) until GRID3 settlements replace it in Stage 3.",
        "_method": __doc__.strip(),
        "year": YEAR, "design_case": "outdoors at night", "denominator": "rural + towns and peri-urban (outside urban centres)",
        "radius_m": {b: round(r[b]) for b in r}, "cutoff_people": cut, "people_per_receiver": per_village,
        "hazard_weights": {"conflict": 1, "fire": 1, "flood": 1},
        "by_year": years,
        "bands": {**bands, "base": {"radius_m": round(r["base"]), "cutoff": cut["base"], "t1": years[YEAR]["t1"], "t1_heard_pct": years[YEAR]["t1_heard_pct"]}},
        "curve": curve,
        "rollout": {"first_tenth_mean_hazard": round(first_hazard, 3), "all_mean_hazard": round(all_hazard, 3)},
        "cells": cell_out,
    }
    with open(os.path.join(DATA, "speakers.json"), "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    y = years[YEAR]
    print(f"{YEAR}: {y['t1']:,} village speakers hear {y['t1_heard']/1e6:.1f}M ({y['t1_heard_pct']}% of the design population {y['design_pop']/1e6:.1f}M); "
          f"{y['t2']:,} receivers for {y['t2_pop']/1e6:.1f}M; urban centres {y['urban_pop']/1e6:.1f}M (phones, radio)")
    print("bands:", out["bands"])
    print("rollout hazard: first tenth", round(first_hazard, 3), "vs all", round(all_hazard, 3))
    print({k: (v["t1"], v["t1_heard_pct"]) for k, v in years.items()})
    print(f"speakers.json {os.path.getsize(os.path.join(DATA, 'speakers.json'))/1e3:.0f} kB")


if __name__ == "__main__":
    main()
