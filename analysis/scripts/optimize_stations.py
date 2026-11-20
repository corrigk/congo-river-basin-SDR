"""
Step 3: ranger station siting -- coverage vs. cost, with a "sweet spot".

Method: greedy maximal-coverage location (a standard heuristic for the
Maximal Covering Location Problem, within (1 - 1/e) of optimal). Each round
adds the candidate site that covers the most NOT-yet-covered people.

Candidate sites: basin grid cells with supply access (within 7 km of a major
river or road, or 15 km of a town). Each site is typed river / road / remote,
which sets its build cost.

Coverage modes ("what does covered mean?"):
  radio     people within radio range of the station tower
  response  people a ranger team can reach within 60 min (boat on rivers,
            vehicle on roads, foot elsewhere) -- Dijkstra on the grid
  speaker   people within intelligible range of the tower loudspeaker
  mix       0.50 radio + 0.35 response + 0.15 speaker (weights editable here)

Outputs data/stations.json : per (mode, year) the station order, cumulative
coverage and cost, the sweet spot, and for every cell the station index at
which it first becomes covered (so the page can redraw the map for any N).
"""
import json, os, math, heapq, base64
import numpy as np
# Grid, site typing and cost, radio sets and the travel graph live in travel.py (shared with stations_from_speakers.py).
from travel import (P, C, idx, nx, res, lon, lat, km2, d_river, n, stype, COST, COST_HYDRO, radio_sets, cand, reach, tv)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data")
NMAX = 400
MIX = {"radio": 0.50, "response": 0.35, "speaker": 0.15}

resp_sets = reach(cand, tv["limit_min"])

L = C["loudspeaker"]
spk_area = math.pi * L["intelligible_radius_km"] ** 2


def speaker_pop(pop):
    dens = pop / km2
    return np.minimum(pop, spk_area * np.minimum(dens * L["village_clustering_factor"], L["max_density_per_km2"]))


def greedy(pop, mode):
    """Lazy greedy. Returns order, gains, first-covered index per cell."""
    covered_r = np.zeros(n, bool)  # radio
    covered_t = np.zeros(n, bool)  # response
    spk = speaker_pop(pop)
    first = np.full(n, 65535, np.uint16)
    wr, wt, ws = {"radio": (1, 0, 0), "response": (0, 1, 0), "speaker": (0, 0, 1),
                  "mix": (MIX["radio"], MIX["response"], MIX["speaker"])}[mode]

    def gain(k):
        g = 0.0
        if wr:
            s = np.asarray(radio_sets[k]); g += wr * pop[s][~covered_r[s]].sum()
        if wt:
            s = resp_sets[k]; g += wt * pop[s][~covered_t[s]].sum()
        if ws:
            g += ws * spk[k] * (first[k] == 65535 or mode != "speaker")
        return g

    heap = [(-gain(int(k)), int(k)) for k in cand]
    heapq.heapify(heap)
    chosen, gains, used = [], [], set()
    while heap and len(chosen) < NMAX:
        g, k = heapq.heappop(heap)
        if k in used:
            continue
        ng = gain(k)
        if heap and ng < -heap[0][0] - 1e-9:
            heapq.heappush(heap, (-ng, k))
            continue
        used.add(k)
        chosen.append(k)
        gains.append(ng)
        j = len(chosen) - 1
        if wr:
            s = np.asarray(radio_sets[k]); new = s[~covered_r[s]]; covered_r[s] = True
            if mode in ("radio", "mix"):
                first[new] = np.minimum(first[new], j)
        if wt:
            s = resp_sets[k]; new = s[~covered_t[s]]; covered_t[s] = True
            if mode in ("response", "mix"):
                first[new] = np.minimum(first[new], j)
        if ws and mode == "speaker":
            first[k] = j
    return chosen, gains, first


def kneedle(x, y):
    """Point of maximum distance below the chord on the normalised curve."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    xn = (x - x[0]) / (x[-1] - x[0]); yn = (y - y[0]) / (y[-1] - y[0])
    return int(np.argmax(yn - xn))


def main():
    out = {"_method": __doc__.strip(), "nmax": NMAX, "mix_weights": MIX,
           "station_cost_15yr": {t: {"capex": round(c[0]), "opex_15yr": round(c[1]), "total": round(sum(c))}
                                 for t, c in COST.items()},
           "hydro_river_station_15yr": {"capex": round(COST_HYDRO[0]), "opex_15yr": round(COST_HYDRO[1]),
                                        "total": round(sum(COST_HYDRO)),
                                        "saving_vs_solar_per_station": round(sum(COST["river"]) - sum(COST_HYDRO))},
           "runs": {}}
    total_cells = n
    for y in P["years"]:
        pop = np.array(P["pop"][str(y)], float)
        tot = pop.sum()
        for mode in ("radio", "response", "speaker", "mix"):
            chosen, gains, first = greedy(pop, mode)
            types = [stype[k] for k in chosen]
            costs = np.cumsum([sum(COST[t]) for t in types])
            capex = np.cumsum([COST[t][0] for t in types])
            if mode == "speaker":
                cum = np.cumsum(gains)
            else:
                # people actually covered (for mix: covered by radio OR 1-hour response)
                order = np.argsort(first)
                cnt = np.bincount(np.minimum(first, len(chosen)).astype(int), weights=pop, minlength=len(chosen) + 1)
                cum = np.cumsum(cnt[:len(chosen)])
            pct = cum / tot * 100
            acnt = np.bincount(np.minimum(first, len(chosen)).astype(int), weights=km2, minlength=len(chosen) + 1)
            area_pct = np.cumsum(acnt[:len(chosen)]) / km2.sum() * 100
            ks = kneedle(np.r_[0, costs], np.r_[0, cum]) or 1
            # alternative sweet spot: last station that still adds >= 0.1% of basin population
            marg = np.diff(np.r_[0, pct])
            under = np.nonzero(marg >= 0.1)[0]
            out["runs"][f"{mode}_{y}"] = {
                "mode": mode, "year": y, "basin_pop": int(tot),
                "stations": [{"lat": round(float(lat[k]), 3), "lon": round(float(lon[k]), 3), "type": types[j],
                              "gain": int(cum[j] - (cum[j-1] if j else 0)), "cum_pct": round(float(pct[j]), 2),
                              "cum_area_pct": round(float(area_pct[j]), 2) if mode != "speaker" else None,
                              "cum_cost_musd": round(float(costs[j]) / 1e6, 2),
                              "hydro_ok": bool(types[j] == "river" or d_river[k] <= 7)}
                             for j, k in enumerate(chosen)],
                "sweet_spot_knee": int(ks),
                "sweet_spot_marginal_0p1pct": int(under[-1] + 1) if len(under) else 0,
                "first_covered_b64": base64.b64encode(first.astype("<u2").tobytes()).decode(),
            }
            r = out["runs"][f"{mode}_{y}"]
            print(f"{mode:9s} {y}: N=100 {pct[99]:5.1f}%  N=200 {pct[199]:5.1f}%  N=400 {pct[-1]:5.1f}%  "
                  f"knee N={ks} ({pct[ks-1]:.1f}%, ${costs[ks-1]/1e6:.0f}M)  last N adding >=0.1%: {r['sweet_spot_marginal_0p1pct']}")
    out["grid"] = {"lon0": P["lon0"], "lat0": P["lat0"], "nx": nx, "res_deg": res, "cells_i_ref": "population.json cells.i"}
    with open(os.path.join(OUT, "stations.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("station 15-yr cost:", out["station_cost_15yr"], "hydro:", out["hydro_river_station_15yr"])
    print(f"stations.json {os.path.getsize(os.path.join(OUT, 'stations.json'))/1e3:.0f} kB")


if __name__ == "__main__":
    main()
