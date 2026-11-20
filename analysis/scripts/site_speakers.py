"""
Where village speakers and community receivers go (brief v3 §7).

DRC (76% of the basin's people): on real settlements, GRID3 COD Settlement Extents v4.0 (build_settlements.py:
1.07M blocks in the basin, people per block = buildings x people per building calibrated per grid cell).
  - a speaker covers every block whose centre is within the voice radius (the acoustic model, acoustic_params.json:
    about 534 m at night out of a 300 m clearing; terrain comes with the pilot DEM);
  - built-up blocks bigger than one speaker's area get as many speakers as cover them;
  - greedy maximum coverage: place the speaker that reaches the most people not yet covered, until the next one would
    reach fewer than the cutoff (150 people);
  - receivers: one per settlement block left uncovered (at least 10 people), one per 500 people beyond that, and one
    per 500 people living outside the mapped settlements.
Other basin countries: MODELED PROXY on WorldPop 2020 1 km (people spread evenly in each pixel) until their settlement
data is added: speakers per pixel where one would still reach the cutoff; receivers one per 500 people.
Urban centres (build_urbanisation.py): phones and radio first (T3), not sited.

Rollout priority comes from the Why map: people heard x (1 + hazard score), the hazard score per grid cell being the
mean of conflict deaths 2015-2024 (UCDP), fire detections 2024 (FIRMS) and flood alerts within 50 km (GDACS), each
log-scaled to 0..1 (equal weights). Years scale the 2020 pattern to each year's total.

Outputs data/speakers.json: per grid cell (population.json order) for the design year, totals per year, the rollout
curve (speakers against people who can hear one), and the low / high bands.
"""
import json, os, math, heapq
import numpy as np
from scipy.spatial import cKDTree
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


BLOCKS = os.path.join(HERE, "..", "raw", "grid3", "blocks.npz")


def greedy_blocks(xy, pop, area, r_km, cutoff):
    """Greedy maximum coverage on settlement blocks. Returns per-speaker (block index, speakers, people heard) and covered."""
    A = math.pi * r_km ** 2
    N = len(pop)
    covered = np.zeros(N, bool)
    out_i, out_n, out_h = [], [], []
    # built-up blocks bigger than one speaker's area: as many speakers as cover them, each still reaching the cutoff
    big = (area > A) & (pop >= cutoff)
    nb = np.minimum(np.ceil(area / A), np.maximum(1, np.floor(pop / cutoff)))
    for i in np.nonzero(big)[0]:
        out_i.append(i); out_n.append(int(nb[i])); out_h.append(float(pop[i]))
    covered[big] = True
    # the rest: lazy greedy over every block centre as a candidate site
    tree = cKDTree(xy)
    lists = tree.query_ball_point(xy, r=r_km)
    lens = np.fromiter((len(l) for l in lists), int, N)
    flat = np.fromiter((j for l in lists for j in l), int, int(lens.sum()))
    off = np.r_[0, np.cumsum(lens)]
    live = np.where(covered, 0.0, pop)
    gain0 = np.add.reduceat(live[flat], off[:-1]) if N else np.zeros(0)
    gain0[lens == 0] = 0
    heap = [(-g, i) for i, g in enumerate(gain0) if g >= cutoff]
    heapq.heapify(heap)
    while heap:
        g, i = heapq.heappop(heap)
        nbr = flat[off[i]:off[i + 1]]
        ng = live[nbr].sum()
        if ng < cutoff:
            continue
        if heap and ng < -heap[0][0] - 1e-9:
            heapq.heappush(heap, (-ng, i)); continue
        out_i.append(i); out_n.append(1); out_h.append(float(ng))
        live[nbr] = 0.0; covered[nbr] = True
    return np.array(out_i, int), np.array(out_n, int), np.array(out_h), covered


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

    # ----- WorldPop pixels -> grid cells (the proxy, outside the DRC) -----
    a, tr, km2 = load_worldpop()
    centre, cluster, *_ = classify(a, km2)
    rows, cols = np.nonzero(a > 0)
    plon, plat = tr * (cols + 0.5, rows + 0.5)
    gidx = lambda lo, la: np.floor((la - lat0 + res / 2) / res).astype(int) * nx + np.floor((lo - lon0 + res / 2) / res).astype(int)
    kcell = np.array([pos.get(int(g), -1) for g in gidx(plon, plat)])
    keep = kcell >= 0
    pop20, pk, cen, kc = a[rows, cols][keep], km2[rows, cols][keep], centre[rows, cols][keep], kcell[keep]
    wp_total = a.sum()

    r = {b: village_radius(b) for b in ("low", "base", "high")}
    area = {b: math.pi * (r[b] / 1000) ** 2 for b in r}
    cut = {b: AP["t1_cutoff_people"][b] for b in ("low", "base", "high")}
    per_village = AP["people_per_village"]["base"]

    # ----- GRID3 settlement blocks (DRC) -----
    have_blocks = os.path.exists(BLOCKS)
    if have_blocks:
        B = np.load(BLOCKS)
        drc = B["drc_cell"]
        bcell, bpop20, barea = B["cell"], B["pop2020"].astype(float), B["area_km2"].astype(float)
        bxy = np.c_[B["lon"] * 111.32 * np.cos(np.radians(B["lat"])), B["lat"] * 110.57]
        # urban centres: blocks whose WorldPop pixel is in an urban centre go to phones and radio first
        inv = ~tr
        bc, br = inv * (B["lon"].astype(float), B["lat"].astype(float))
        br, bc = np.clip(np.floor(br).astype(int), 0, a.shape[0] - 1), np.clip(np.floor(bc).astype(int), 0, a.shape[1] - 1)
        bcen = centre[br, bc]
        out_cell = B["outside_cell"].astype(float)
        use_proxy = ~drc[kc]                                   # pixels outside the DRC keep the proxy
        print(f"GRID3 blocks: {len(bpop20):,} ({bcen.sum():,} in urban centres)")
    else:
        drc = np.zeros(ncell, bool); use_proxy = np.ones(len(kc), bool)
        print("GRID3 blocks not found: proxy everywhere (run build_settlements.py)")

    def run(f, band):
        """One siting at population scale f: per-cell speakers, people heard, receivers, people on receivers, urban, and speaker units."""
        c_t1, c_h, c_t2, c_t2p, c_u = (np.zeros(ncell) for _ in range(5))
        units = []                                             # (cell, speakers, people heard)
        # proxy pixels
        pop = pop20 * f
        n, heard = site(pop, pk, area[band], cut[band])
        sel = use_proxy & ~cen
        n = np.where(sel, n, 0); heard = np.where(sel, heard, 0)
        t2p = np.where(sel & (n == 0), pop, 0)
        c_t1 += np.bincount(kc, weights=n, minlength=ncell); c_h += np.bincount(kc, weights=heard, minlength=ncell)
        c_t2p += np.bincount(kc, weights=t2p, minlength=ncell); c_t2 += np.bincount(kc, weights=t2p, minlength=ncell) / per_village
        c_u += np.bincount(kc, weights=np.where(use_proxy & cen, pop, 0), minlength=ncell)
        m = n > 0
        units.append(np.c_[kc[m], n[m], heard[m]])
        if have_blocks:
            bp = bpop20 * f
            site_b = ~bcen
            ii, nn, hh, cov = greedy_blocks(bxy[site_b], bp[site_b], barea[site_b], r[band] / 1000, cut[band])
            idx = np.nonzero(site_b)[0]
            cs = bcell[idx[ii]]
            c_t1 += np.bincount(cs, weights=nn, minlength=ncell); c_h += np.bincount(cs, weights=hh, minlength=ncell)
            units.append(np.c_[cs, nn, hh])
            # receivers: one per uncovered block of at least 10 people, plus one per 500 beyond; and the people outside blocks
            ub = idx[~cov]; up = bp[ub]
            rec = np.where(up >= 10, 1 + np.floor(np.maximum(up - 500, 0) / per_village), 0)
            c_t2 += np.bincount(bcell[ub], weights=rec, minlength=ncell) + out_cell * f / per_village
            c_t2p += np.bincount(bcell[ub], weights=up, minlength=ncell) + out_cell * f
            c_u += np.bincount(bcell[bcen], weights=bp[bcen], minlength=ncell)
        return c_t1, c_h, c_t2, c_t2p, c_u, np.vstack(units)

    years = {}
    for y in P["years"]:
        y = str(y)
        f = float(np.sum(P["pop"][y])) / wp_total             # the 2020 pattern scaled to each year's total
        c_t1, c_h, c_t2, c_t2p, c_u, units = run(f, "base")
        design = U["by_year"][y]["town_periurban"] + U["by_year"][y]["rural"]
        years[y] = {"t1": int(round(c_t1.sum())), "t1_heard": int(c_h.sum()), "t2": int(round(c_t2.sum())),
                    "t2_pop": int(c_t2p.sum()), "urban_pop": int(c_u.sum()), "design_pop": int(design),
                    "t1_heard_pct": round(float(c_h.sum() / design * 100), 1)}
        print(f"  {y}: {years[y]['t1']:,} speakers, {years[y]['t1_heard_pct']}% heard, {years[y]['t2']:,} receivers")
        if y == YEAR:
            # rollout curve: speaker units in priority order (people heard per speaker x (1 + hazard))
            ucell, un, uh = units[:, 0].astype(int), units[:, 1], units[:, 2]
            pr = uh / un * (1 + score[ucell])
            order = np.argsort(-pr)
            cum_n = np.cumsum(un[order]); cum_h = np.cumsum(uh[order])
            marks = sorted(set([int(x) for x in np.unique(np.round(np.geomspace(100, max(cum_n[-1], 101), 40)))]))
            curve = {"n": [], "pct": []}
            for m in marks:
                j = min(len(cum_n) - 1, int(np.searchsorted(cum_n, m)))
                curve["n"].append(int(cum_n[j])); curve["pct"].append(round(float(cum_h[j] / design * 100), 2))
            first = order[: max(1, len(order) // 10)]
            first_hazard = float(np.average(score[ucell[first]], weights=un[first]))
            all_hazard = float(np.average(score[ucell], weights=un))
            bands = {}
            for band in ("low", "high"):
                bt1, bh, *_ = run(f, band)
                bands[band] = {"radius_m": round(r[band]), "cutoff": cut[band], "t1": int(round(bt1.sum())), "t1_heard_pct": round(float(bh.sum() / design * 100), 1)}
            cell_out = {
                "t1": np.round(c_t1).astype(int).tolist(),
                "heard": np.round(c_h).astype(int).tolist(),
                "t2": np.round(c_t2, 1).tolist(),
                "urban": np.round(c_u).astype(int).tolist(),
                "hazard": np.round(score, 3).tolist(),
                "grid3": drc.astype(int).tolist() if have_blocks else [0] * ncell,
            }

    out = {
        "_note": ("DRC: GRID3 COD Settlement Extents v4.0 (CC BY-SA 4.0), people per block calibrated to WorldPop 2020 per grid cell. "
                  "Other basin countries: MODELED PROXY on WorldPop 2020 1 km until their settlement data is added." if have_blocks
                  else "MODELED PROXY on WorldPop 2020 1 km (people spread evenly within each pixel) until GRID3 settlements replace it."),
        "sources": {"drc": "GRID3 COD Settlement Extents v4.0 (CIESIN / GRID3, CC BY-SA 4.0)" if have_blocks else None, "elsewhere": "WorldPop 2020 1 km proxy"},
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
