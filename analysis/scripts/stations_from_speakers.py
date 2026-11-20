"""
Ranger stations derived from the village speakers (brief v3 §9): each station's crews look after the speakers within
an 8-hour trip, up to X speakers per station (crew-hours calculator, maintenance_params.json).

Capacitated covering, greedy: open the candidate site that can take the most unassigned speakers (at most X within
T_maint, lazy evaluation); assign it the nearest unassigned speakers up to X; repeat until every reachable speaker has
a station. A site can host more than one station (one more crew house) where speakers are dense. Candidate sites and
the travel model are the SRR's (travel.py: boat on rivers, vehicle on roads, foot elsewhere).

Then the speaker-driven station order gets the same coverage curve as the SRR modes (people within radio reach or a
1-hour response, cumulative cost), so the Design tab's S-3 network step and the Trades model can use it as a fifth
mode, 'alerts'.

Outputs data/stations_speaker.json: the stations, each cell's station, the X x T_maint trade table, the comparison
with the SRR sweet spot, and an 'alerts' run per year.
"""
import json, os, heapq, base64
import numpy as np
import travel as T

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
load = lambda f: json.load(open(os.path.join(DATA, f)))
MP = load("maintenance_params.json")
SPK = load("speakers.json")
STN = load("stations.json")


def x_from_crew(b="base", **o):
    v = lambda k: o.get(k, MP[k][b])
    return int(v("crews_per_station") * v("crew_hours_yr") // (v("visits_per_speaker_yr") * v("hours_per_visit")))


def derive(t1, X, limit_min, reach_cache={}):
    """Greedy capacitated cover. Returns stations [(cell, n_speakers, max_min, mean_min)], per-cell station, unassigned."""
    key = limit_min
    if key not in reach_cache:
        reach_cache[key] = T.reach(T.cand, limit_min, times=True)
    R = reach_cache[key]
    rem = t1.astype(float).copy()
    owner = np.full(T.n, -1, np.int32)
    gain = lambda k: min(X, rem[R[k][0]].sum())
    heap = [(-gain(int(k)), int(k)) for k in T.cand]
    heapq.heapify(heap)
    out = []
    while heap:
        g, k = heapq.heappop(heap)
        if -g <= 0:
            break
        ng = gain(k)
        if heap and ng < -heap[0][0] - 1e-9:
            heapq.heappush(heap, (-ng, k)); continue
        if ng <= 0:
            continue
        cells, mins = R[k]
        order = np.argsort(mins)
        left, used_max, tot_t, taken_total = X, 0.0, 0.0, 0.0
        for j in order:
            c = cells[j]
            if rem[c] <= 0 or left <= 0:
                continue
            take = min(rem[c], left)
            rem[c] -= take; left -= take
            if owner[c] < 0 or take >= t1[c] / 2: owner[c] = len(out)
            used_max = max(used_max, mins[j]); tot_t += take * mins[j]; taken_total += take
        out.append((k, taken_total, used_max, tot_t / max(taken_total, 1)))
        heapq.heappush(heap, (-gain(k), k))           # the same site can take another station if speakers remain
    return out, owner, rem.sum()


def coverage_run(order_cells, y):
    """The SRR mix metric for a station order: people within radio reach or a 1-hour response, cumulative cost."""
    pop = np.array(T.P["pop"][str(y)], float)
    resp = T.reach(np.array(sorted(set(order_cells))), T.tv["limit_min"])
    cov = np.zeros(T.n, bool); first = np.full(T.n, 65535, np.uint16)
    stations, cum, cost = [], 0.0, 0.0
    for j, k in enumerate(order_cells):
        s = np.unique(np.r_[np.asarray(T.radio_sets[k], int), resp[k]])
        new = s[~cov[s]]; cov[s] = True; first[new] = np.minimum(first[new], min(j, 65534))
        cum += pop[new].sum(); t = str(T.stype[k]); cost += sum(T.COST[t])
        stations.append({"lat": round(float(T.lat[k]), 3), "lon": round(float(T.lon[k]), 3), "type": t, "gain": int(pop[new].sum()),
                         "cum_pct": round(float(cum / pop.sum() * 100), 2), "cum_area_pct": None, "cum_cost_musd": round(cost / 1e6, 2),
                         "hydro_ok": bool(t == "river" or T.d_river[k] <= 7)})
    return {"mode": "alerts", "year": y, "basin_pop": int(pop.sum()), "stations": stations, "sweet_spot_knee": len(stations),
            "sweet_spot_marginal_0p1pct": len(stations), "first_covered_b64": base64.b64encode(first.astype("<u2").tobytes()).decode()}


def main():
    t1 = np.array(SPK["cells"]["t1"], float)
    X, Tm = x_from_crew(), MP["t_maint_h"]["base"] * 60
    stations, owner, unassigned = derive(t1, X, Tm)
    n = len(stations)
    srr = next(s["stations"] for s in load("budget.json")["sweet_spots"] if s["run"] == "mix_2041")

    # X x T_maint trade table (the page's curve): how many stations each pair needs
    xs = sorted({50, 100, 150, 200, X, 400, 600, 1000, 2000})
    sweep = {}
    for h in (MP["t_maint_h"]["low"], MP["t_maint_h"]["base"], MP["t_maint_h"]["high"]):
        sweep[str(h)] = []
        for x in xs:
            st_, _, un = derive(t1, x, h * 60)
            sweep[str(h)].append({"X": x, "stations": len(st_), "unassigned": int(round(un))})
        print(f"T_maint {h} h:", [(r["X"], r["stations"], r["unassigned"]) for r in sweep[str(h)]])

    order_cells = [k for k, *_ in stations]
    runs = {str(y): coverage_run(order_cells, y) for y in T.P["years"]}
    sites = len(set(order_cells))
    out = {
        "_note": "Built on the MODELED PROXY speaker layer (speakers.json) and assumed crew numbers (maintenance_params.json); Stage 3/4 refine both.",
        "_method": __doc__.strip(),
        "T_maint_h": MP["t_maint_h"]["base"], "X": X, "x_formula": {k: MP[k]["base"] for k in ("crews_per_station", "crew_hours_yr", "visits_per_speaker_yr", "hours_per_visit")},
        "speakers": int(t1.sum()), "assigned": int(round(t1.sum() - unassigned)), "unassigned": int(round(unassigned)),
        "stations": [{"lat": round(float(T.lat[k]), 3), "lon": round(float(T.lon[k]), 3), "type": str(T.stype[k]), "n_speakers": int(round(c)),
                      "max_travel_h": round(mx / 60, 1), "mean_travel_h": round(mn / 60, 1)} for k, c, mx, mn in stations],
        "sites": sites,
        "owner_b64": base64.b64encode(np.where(owner < 0, 65535, owner).astype("<u2").tobytes()).decode(),
        "compare": {"srr_sweet_spot": srr, "speaker_driven": n, "sites": sites},
        "sweep": sweep,
        "runs": runs,
    }
    with open(os.path.join(DATA, "stations_speaker.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    mt = [s["max_travel_h"] for s in out["stations"]]
    print(f"X = {X} speakers per station (crew-hours), T_maint {MP['t_maint_h']['base']} h: {n:,} stations at {sites:,} sites for "
          f"{out['assigned']:,} speakers ({out['unassigned']:,} beyond reach); SRR sweet spot {srr}")
    print(f"longest trip {max(mt)} h; mix coverage of these stations in 2041: {runs['2041']['stations'][-1]['cum_pct']}% for ${runs['2041']['stations'][-1]['cum_cost_musd']}M")
    print(f"stations_speaker.json {os.path.getsize(os.path.join(DATA, 'stations_speaker.json'))/1e3:.0f} kB")


if __name__ == "__main__":
    main()
