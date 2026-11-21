"""
Routes for the crew-rounds animation (Design tab, "Crew rounds"): three showcase major hubs from the default hub
design (hubs_from_speakers.py), one river, one road and one remote, with every place their crews go and the route
there on the SRR travel model (travel.py: boat on rivers, vehicle on roads, foot elsewhere; 14 km cells).

  place     a day-trip area worked straight from the major hub, a minor hub (rangers stay), or a village stay
  route     the cells on the fastest path from the major hub, each with its travel mode and the minutes to reach it
  local     up to 10 speaker cells around a minor hub or village stay, with the minutes from it

Writes data/rounds.json. Called by hubs_from_speakers.py with the default design.
"""
import json, os
import numpy as np
from scipy.sparse.csgraph import dijkstra
import travel as T

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MODE = lambda c: "boat" if T.d_river[c] <= T.tv["corridor_km"] else "road" if T.d_road[c] <= T.tv["corridor_km"] else "foot"
LL = lambda c: [round(float(T.lon[c]), 3), round(float(T.lat[c]), 3)]


def route(pred, dist, src, dst):
    path = [dst]
    while path[-1] != src and pred[path[-1]] >= 0:
        path.append(int(pred[path[-1]]))
    path.reverse()
    return [[*LL(c), MODE(c), round(float(dist[c]))] for c in path]


def zone(lat):
    return "north" if lat >= 2 else "south" if lat <= -2 else "equator"


def trip_modes(M, chunks, hubs, t_local):
    """For seasons: per latitude zone of the major hub, how the travel minutes of its trips split between boat, road
    and foot (stays: major to minor hub; day trips: major to the area), with the number of places as weight."""
    out = {z: {"stay": {"boat": 0.0, "road": 0.0, "foot": 0.0}, "day": {"boat": 0.0, "road": 0.0, "foot": 0.0}, "places": 0} for z in ("north", "equator", "south")}
    by_major = {}
    for m, i, sp, t in chunks: by_major.setdefault(m, set()).add((i, t > t_local))
    for m, places in by_major.items():
        k = int(M[m][0]); z = out[zone(float(T.lat[k]))]
        dist, pred = dijkstra(T.G, indices=k, return_predecessors=True, limit=36 * 60)
        for i, stay in places:
            c = hubs[i][0]; kind = "stay" if stay else "day"
            while c != k and pred[c] >= 0:
                p = int(pred[c]); z[kind][MODE(c)] += float(dist[c] - dist[p]); c = p
            z["places"] += 1
    for z in out.values():
        for kind in ("stay", "day"):
            s = sum(z[kind].values()) or 1
            z[kind] = {m: round(v / s, 3) for m, v in z[kind].items()}
    return out


def export(M, chunks, hubs, hub_of, t1, t_local, min_minor, max_places=30):
    by_major = {}
    for m, i, sp, t in chunks:
        by_major.setdefault(m, {}).setdefault(i, [0.0, t])[0] += sp
    pick = {}
    for m, places in by_major.items():
        k = int(M[m][0]); ty = str(T.stype[k])
        stays = sum(1 for i, (sp, t) in places.items() if t > t_local)
        if len(places) > max_places or stays < 3: continue
        score = stays + sum(1 for i, (sp, t) in places.items() if t > t_local and hubs[i][1] >= min_minor) * 2
        if ty not in pick or score > pick[ty][0]: pick[ty] = (score, m)
    out = []
    for ty in ("river", "road", "remote"):
        if ty not in pick: continue
        m = pick[ty][1]; k = int(M[m][0]); places = by_major[m]
        far = max(t for sp, t in places.values())
        dist, pred = dijkstra(T.G, indices=k, return_predecessors=True, limit=far + 1)
        P = []
        for i, (sp, t) in sorted(places.items(), key=lambda kv: kv[1][1]):
            c = hubs[i][0]
            kind = "day" if t <= t_local else "minor" if hubs[i][1] >= min_minor else "village"
            members = np.nonzero(hub_of == i)[0]
            loc = []
            if kind != "day" and len(members):
                ld = dijkstra(T.G, indices=c, limit=t_local + 1)
                members = members[np.argsort(-t1[members])][:10]
                loc = [[*LL(int(q)), int(round(t1[q])), round(float(ld[q]))] for q in members if np.isfinite(ld[q])]
            P.append({"kind": kind, "lon": LL(c)[0], "lat": LL(c)[1], "speakers": int(round(sp)), "minutes": round(t),
                      "local_min": round(hubs[i][2]), "route": route(pred, dist, k, c), "local": loc})
        out.append({"type": ty, "lon": LL(k)[0], "lat": LL(k)[1], "speakers": int(round(sum(sp for sp, _ in places.values()))), "places": P})
        print(f"  rounds: {ty} major at {LL(k)}: {len(P)} places ({sum(p['kind'] == 'minor' for p in P)} minor, "
              f"{sum(p['kind'] == 'village' for p in P)} village, {sum(p['kind'] == 'day' for p in P)} day), {out[-1]['speakers']} speakers")
    res = {"_note": "Showcase major hubs of the default hub design and the routes their crews take (travel.py). Modeled.",
           "_method": __doc__.strip(), "t_local_min": t_local, "speeds_kmh": {"boat": T.tv["boat_kmh"], "road": T.tv["road_kmh"], "foot": T.tv["foot_kmh"]},
           "majors": out}
    with open(os.path.join(DATA, "rounds.json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
