"""
Major and minor ranger hubs derived from the village speakers (team design, 2026-11-20).

  major hub   where crews live: vehicles, workshop, the area's radio repeater, backhaul. At a candidate station site
              (travel.py: near a river, road or town).
  minor hub   an outstation in a village where one or two rangers stay a night or two and work the speakers around it
              on day trips. No one lives there.

Two steps, on the travel model of the SRR (travel.py: boat 25 km/h on rivers, 30 on roads, 3 on foot; 14 km cells):

  A. service hubs: every cell with speakers must lie within a day trip (T_local, 3 h one way) of a hub. Greedy maximum
     coverage over the speaker cells: open the cell whose day-trip reach takes the most uncovered speakers.
  B. major hubs: capacitated greedy over the candidate sites, as stations_from_speakers.py, but covering the service
     hubs within one day's travel (T_day, 8 h): open the site that can take the most unassigned hub speakers (at most
     X), nearest hubs first. A hub within T_local of its major is worked on day trips from the major; a hub further
     out becomes a minor hub that crews reach once per stay. Hubs beyond T_day of every candidate site get REMOTE
     major hubs where a cluster of at least 50 speakers justifies one (any hub cell; everything carried in, logistics
     x1.6); smaller leftovers are reached as long stays from the nearest major within two days (24 h); only what is
     beyond that too gets a remote major regardless.
  C. a minor hub serving fewer than 10 speakers is not built: rangers lodge in the village (a village stay).
     The 14 km travel cells make every forest cell its own day-trip area on foot, so many hubs are small.
     Run for T_day = 8 h (one day), 12 h (a long day) and 24 h (two days' travel).

X (speakers per major hub, with its most crews) comes from the crews (src/s3/coverage/stationkit.js, same formula);
each major hub then gets only the crews its speakers need (the sweep keeps each X's spread of speakers per major):
  team-days a year   = crews x people per crew x field days / rangers per team
  X                  = team-days / team-days needed per speaker a year (need(): whole trips per place, since the
                       crew-rounds simulation showed averaging over speakers undercounts: every place crews stay at
                       needs at least one full trip a year, and faults far out need repair trips of their own)

Outputs data/hubs.json: the X sweep (major and minor hubs, trips, shares, access types), the default design's hubs
for the map, and its 'alerts' coverage runs (people within radio reach or a 1-hour response of a major hub: minor hubs
are empty most of the time, so they do not count for response).
"""
import json, os, heapq, math
import numpy as np
import travel as T
from stations_from_speakers import coverage_run
import rounds_routes

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
load = lambda f: json.load(open(os.path.join(DATA, f), encoding="utf-8"))
KIT = load("station_kit.json")
SPK = load("speakers.json")
b = lambda sec, k: KIT[sec][k]["base"]
T_LOCAL, T_DAY = b("stay", "t_local_h") * 60, b("stay", "t_day_h") * 60
T_DAYS = [8, 12, 24]
T_DAY_RUN = [T_DAY]   # the T_day of the run in progress (summarise reports the share beyond it)
MIN_MINOR, MIN_REMOTE, T_FAR = 10, 50, 24 * 60
LOAD_BINS = [0, 10, 25, 50, 100, 200, 300, 450, 700, 1000, 1500, 2200, 3200, 5000, 1e9]
STAY_SP = [0, 3, 6, 10, 20, 40, 80, 160, 1e9]          # speakers at a place crews stay at
STAY_T = [0, 4, 6, 8, 10, 12, 16, 20, 1e9]             # hours from its major hub
XS = [100, 200, 300, 500, 800, 1200, 2000, 3000, 5000]


def service_hubs(t1):
    """Step A. Returns hubs [(cell, speakers, mean local trip min)] and each speaker cell's hub."""
    cells = np.nonzero(t1 > 0)[0]
    R = T.reach(cells, T_LOCAL, times=True)
    rem = t1.copy()
    hub_of = np.full(T.n, -1, np.int32)
    gain = lambda k: rem[R[k][0]].sum()
    heap = [(-gain(int(k)), int(k)) for k in cells]
    heapq.heapify(heap)
    hubs = []
    while heap:
        g, k = heapq.heappop(heap)
        ng = gain(k)
        if ng <= 0: continue
        if heap and ng < -heap[0][0] - 1e-9:
            heapq.heappush(heap, (-ng, k)); continue
        cs, ms = R[k]
        take = rem[cs] > 0
        cs, ms = cs[take], ms[take]
        sp = rem[cs]
        hubs.append((k, float(sp.sum()), float((sp * ms).sum() / sp.sum())))
        hub_of[cs] = len(hubs) - 1
        rem[cs] = 0
    return hubs, hub_of


def majors(hubs, X, R8, Rr, Rfar):
    """Step B. Capacitated greedy over the candidate sites, then remote majors for what is left.
    Returns majors [(cell, taken)], chunks [(major, hub, speakers, minutes)], unassigned."""
    hcell = np.array([h[0] for h in hubs]); hsp = np.array([h[1] for h in hubs])
    at = {}
    for i, c in enumerate(hcell): at.setdefault(int(c), []).append(i)
    # per candidate: the hubs within T_day, nearest first
    def nearest(R, k):
        cs, ms = R[int(k)]
        hs, ts = [], []
        for c, m in zip(cs, ms):
            for i in at.get(int(c), ()):
                hs.append(i); ts.append(m)
        if hs:
            o = np.argsort(ts); return np.array(hs)[o], np.array(ts)[o]
    rem = hsp.copy()
    out, chunks = [], []
    greedy({int(k): v for k in T.cand if (v := nearest(R8, k)) is not None}, rem, X, out, chunks)
    remote = {int(k): v for k in Rr if (v := nearest(Rr, k)) is not None}
    greedy(remote, rem, X, out, chunks, min_gain=MIN_REMOTE)
    # small leftovers: a long stay from the nearest major within two days
    mcell = {}
    for j, (k, _) in enumerate(out): mcell.setdefault(int(k), j)
    for i in np.nonzero(rem > 0)[0]:
        cs, ms = Rfar[int(hcell[i])]
        best = min(((m, mcell[int(c)]) for c, m in zip(cs, ms) if int(c) in mcell), default=None)
        if best is not None:
            chunks.append((best[1], int(i), float(rem[i]), float(best[0]))); out[best[1]] = (out[best[1]][0], out[best[1]][1] + rem[i]); rem[i] = 0
    greedy(remote, rem, X, out, chunks)
    return out, chunks, float(rem.sum())


def greedy(near, rem, X, out, chunks, min_gain=1e-9):
    gain = lambda k: min(X, rem[near[k][0]].sum())
    heap = [(-gain(k), k) for k in near]
    heapq.heapify(heap)
    while heap:
        g, k = heapq.heappop(heap)
        ng = gain(k)
        if ng < min_gain: continue
        if heap and ng < -heap[0][0] - 1e-9:
            heapq.heappush(heap, (-ng, k)); continue
        left, took = X, 0.0
        for i, t in zip(*near[k]):
            if left <= 0: break
            if rem[i] <= 0: continue
            take = min(rem[i], left); rem[i] -= take; left -= take; took += take
            chunks.append((len(out), int(i), float(take), float(t)))
        out.append((k, took))
        heapq.heappush(heap, (-gain(k), k))


def summarise(hubs, M, chunks, unassigned):
    hloc = np.array([h[2] for h in hubs])
    sp = np.array([c[2] for c in chunks]); hi = np.array([c[1] for c in chunks]); tm = np.array([c[3] for c in chunks])
    direct = tm <= T_LOCAL
    dep = ~direct
    hsp = np.array([h[1] for h in hubs])
    stays = sorted(set(hi[dep].tolist()))
    minors = [i for i in stays if hsp[i] >= MIN_MINOR]; village = [i for i in stays if hsp[i] < MIN_MINOR]
    w = lambda m, v: float((sp[m] * v[m]).sum() / max(sp[m].sum(), 1e-9))
    types = lambda cells: {t: int(sum(1 for c in cells if T.stype[c] == t)) for t in ("road", "river", "remote")}
    load = np.array([t for _, t in M])
    hist = [[int(((load > lo) & (load <= hi)).sum()), round(float(load[(load > lo) & (load <= hi)].mean()), 1)]
            for lo, hi in zip(LOAD_BINS[:-1], LOAD_BINS[1:]) if ((load > lo) & (load <= hi)).any()]
    # every place crews stay at (minor hub or village stay): its speakers, the trip from its major, the local trip;
    # binned by speakers x trip, so the page can count whole trips per place (crew rounds showed averages undercount)
    pl = {}
    for m, i, s_, t in zip([c[0] for c in chunks], hi, sp, tm):
        if t <= T_LOCAL: continue
        a = pl.setdefault((m, int(i)), [0.0, 0.0]); a[0] += s_; a[1] += s_ * t
    psp = np.array([a[0] for a in pl.values()]); pT = np.array([a[1] / a[0] for a in pl.values()]) / 60
    ploc = np.array([hloc[i] for (_, i) in pl]) / 60
    bins = []
    for s0, s1 in zip(STAY_SP[:-1], STAY_SP[1:]):
        for t0, t1 in zip(STAY_T[:-1], STAY_T[1:]):
            k = (psp > s0) & (psp <= s1) & (pT > t0) & (pT <= t1)
            if k.any(): bins.append([int(k.sum()), round(float(psp[k].mean()), 2), round(float(pT[k].mean()), 2), round(float(ploc[k].mean()), 2)])
    return {
        "load_hist": hist,                                                # [majors, mean speakers] per load bin: crews as needed
        "stay_bins": bins,                                                # [places, mean speakers, trip h, local trip h]
        "majors": len(M), "major_sites": len({k for k, _ in M}), "minors": len(minors), "village_stays": len(village),
        "share_far": round(float(sp[tm > T_DAY_RUN[0]].sum() / sp.sum()), 3),
        "assigned": int(round(sp.sum())), "unassigned": int(round(unassigned)),
        "share_direct": round(float(sp[direct].sum() / sp.sum()), 3),
        "t_direct_h": round(w(direct, tm + hloc[hi]) / 60, 2),            # major to the speakers on day trips
        "t_dep_h": round(w(dep, tm) / 60, 2),                             # major to the minor hub
        "t_loc_h": round(w(dep, hloc[hi]) / 60, 2),                       # minor hub to its speakers
        "major_types": types([k for k, _ in M]), "minor_types": types([hubs[i][0] for i in minors]),
    }, minors


def x_from(sweep, kit):
    """The page's formula (stationkit.js), on the sweep: a few fixed-point steps because the trips depend on X."""
    def interp(X, key):
        xs = [r["X"] for r in sweep]
        if X <= xs[0]: return sweep[0][key]
        for i in range(1, len(xs)):
            if X <= xs[i]:
                t = (math.log(X) - math.log(xs[i - 1])) / (math.log(xs[i]) - math.log(xs[i - 1]))
                return sweep[i - 1][key] + t * (sweep[i][key] - sweep[i - 1][key])
        return sweep[-1][key]
    cap = kit["crews"] * kit["people"] * kit["days"] / kit["team"]
    X = 500
    for _ in range(8):
        row = min(sweep, key=lambda r: abs(math.log(r["X"] / X)))
        X = cap / need(row, interp(X, "share_direct"), interp(X, "t_direct_h"), kit)
    return int(X)


def need(row, s, td, kit):
    """Team-days a year per speaker, counting whole trips per place (stationkit.js, same formula):
    day trips: routine visits shared over a round, repairs over half a round;
    stays: each place at least one routine stay a year (its speakers' visits), plus repair trips for faults that
    no stay picks up within the wait allowed (faults batch: one trip takes those arriving in the wait)."""
    W, cr = kit["fault_wait"], 0.5 if kit["caretaker"] else 1
    vR, rep, dh = kit["routine"] * cr, kit["repair"] * cr, kit["day_h"]
    direct = s * (kit["routine"] * (kit["onsite"] + 2 * td / kit["perRound"]) + rep * (kit["onsite"] + 2 * td / max(1, kit["perRound"] / 2))) / dh
    tot = 0.0
    for c, sp, T_, tl in row["stay_bins"]:
        per_stay = kit["work_days"] * dh / (kit["onsite"] + 2 * tl / kit["perRound"])
        nR = math.ceil(sp * vR / per_stay) if vR > 0 else 0
        lr = sp * rep * (1 - min(1, nR * W / 365)); m = lr / (1 + lr * W / 365)
        tot += c * (nR * (2 * T_ / dh + kit["work_days"]) + m * (2 * T_ / dh + 1))
    return direct + tot / row["assigned"]


def main():
    t1 = np.array(SPK["cells"]["t1"], float)
    hubs, hub_of = service_hubs(t1)
    print(f"step A: {len(hubs):,} service hubs (day trips of up to {T_LOCAL/60:.0f} h) for {t1.sum():,.0f} speakers in {(t1 > 0).sum():,} cells")
    hub_cells = np.array(sorted({h[0] for h in hubs}))
    Rfar = T.reach(hub_cells, T_FAR, times=True)
    sweeps, RR = {}, {}
    for td in T_DAYS:
        R8 = T.reach(T.cand, td * 60, times=True)
        Rr = T.reach(np.setdiff1d(hub_cells, T.cand), td * 60, times=True)   # remote majors: any hub cell off the access network
        RR[td] = (R8, Rr, Rfar); T_DAY_RUN[0] = td * 60
        sweeps[str(td)] = sw = []
        print(f"T_day {td} h:")
        for X in XS:
            M, ch, un = majors(hubs, X, R8, Rr, Rfar)
            s, _ = summarise(hubs, M, ch, un)
            sw.append({"X": X, **s})
            print(f"  X {X:>5}: {s['majors']:>5} major ({s['major_types']}), {s['minors']:>5} minor + {s['village_stays']} village; far {s['share_far']:.0%}; day trips {s['share_direct']:.0%} "
                  f"({s['t_direct_h']} h), stays: {s['t_dep_h']} h out, {s['t_loc_h']} h local; unassigned {s['unassigned']:,}")
    kit = {"crews": KIT["crew"]["crews"]["base"], "people": KIT["crew"]["people"]["base"], "days": b("crew", "field_days"), "team": b("crew", "team"),
           "day_h": b("crew", "day_h"), "routine": b("visits", "routine_yr"), "repair": b("visits", "repair_yr"), "onsite": b("visits", "onsite_h"),
           "perRound": b("visits", "per_round"), "work_days": b("stay", "work_days"), "fault_wait": b("visits", "fault_wait_d"), "caretaker": False}
    td0 = int(T_DAY / 60)
    X = x_from(sweeps[str(td0)], kit)
    T_DAY_RUN[0] = td0 * 60
    M, ch, un = majors(hubs, X, *RR[td0])
    s, minors = summarise(hubs, M, ch, un)
    # the default design for the map: majors in greedy order, each minor hub with its major and the trip there
    first_major = {}
    for m, i, sp, t in ch:
        if t > T_LOCAL and i not in first_major: first_major[i] = (m, t)
    mj_sp = np.zeros(len(M))
    for m, i, sp, t in ch: mj_sp[m] += sp
    out = {
        "_note": "Built on the GRID3 speakers (speakers.json), the SRR travel model (travel.py) and assumed crew numbers (station_kit.json).",
        "_method": __doc__.strip(),
        "t_local_h": T_LOCAL / 60, "min_minor": MIN_MINOR, "min_remote": MIN_REMOTE, "t_day_h": td0, "service_hubs": len(hubs), "speakers": int(t1.sum()),
        "t_days": T_DAYS, "sweep": sweeps, "default": {"X": X, "kit": kit, **s},
        "majors": [[round(float(T.lon[k]), 3), round(float(T.lat[k]), 3), str(T.stype[k]), int(round(mj_sp[j]))] for j, (k, _) in enumerate(M)],
        "minors": [[round(float(T.lon[hubs[i][0]]), 3), round(float(T.lat[hubs[i][0]]), 3), str(T.stype[hubs[i][0]]), int(round(hubs[i][1])),
                    first_major[i][0], round(first_major[i][1] / 60, 1)] for i in minors],
        "village_stays": [[round(float(T.lon[hubs[i][0]]), 3), round(float(T.lat[hubs[i][0]]), 3), first_major[i][0]] for i in sorted(first_major) if hubs[i][1] < MIN_MINOR],
        "runs": {str(y): coverage_run([k for k, _ in M], y) for y in T.P["years"]},
    }
    with open(os.path.join(DATA, "hubs.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    last = out["runs"]["2041"]["stations"][-1]
    print(f"default X = {X}: {s['majors']} major hubs + {s['minors']} minor hubs, {s['unassigned']:,} speakers beyond reach; "
          f"major hubs reach {last['cum_pct']}% of people by radio or a 1-hour response; hubs.json {os.path.getsize(os.path.join(DATA, 'hubs.json'))/1e3:.0f} kB")
    rounds_routes.export(M, ch, hubs, hub_of, t1, T_LOCAL, MIN_MINOR)   # showcase routes for the crew-rounds animation


if __name__ == "__main__":
    main()
