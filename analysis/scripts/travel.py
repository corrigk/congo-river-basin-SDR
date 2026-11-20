"""
Shared grid, station sites and travel model for the station scripts (optimize_stations.py, stations_from_speakers.py).

  grid        the population grid's cells (population.json): position, area, distances to river, road and town
  sites       candidate station cells (within 7 km of a major river or road, or 15 km of a town), typed
              river / road / remote, with each type's 15-year cost from cost_model.json
  radio_sets  cells within radio range of each cell
  graph       travel time (minutes) between neighbouring cells: boat on rivers, vehicle on roads, foot elsewhere
  reach()     cells reachable within a time limit from a set of cells (Dijkstra on the graph)
"""
import json, os, math
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
KM_PER_DEG = 111.32

P = json.load(open(os.path.join(DATA, "population.json")))
C = json.load(open(os.path.join(DATA, "cost_model.json")))
idx = np.array(P["cells"]["i"])
nx, res = P["nx"], P["res_deg"]
lon = P["lon0"] + (idx % nx) * res
lat = P["lat0"] + (idx // nx) * res
km2 = np.array(P["cells"]["km2"])
d_river = np.array(P["cells"]["river_km"])
d_road = np.array(P["cells"]["road_km"])
d_town = np.array(P["cells"]["town_km"])
n = len(idx)
pos = {int(g): k for k, g in enumerate(idx)}

# ---------------- site typing and cost ----------------
access = (d_river <= 7) | (d_road <= 7) | (d_town <= 15)
stype = np.where(d_road <= 7, "road", np.where(d_river <= 7, "river", "remote"))
st = C["station"]
base_capex = sum(i["usd"] for i in st["capex_items"])


def site_cost(t, hydro=False):
    capex = base_capex + st["access_kit"][t]["usd"]
    batt = st["opex"]["battery_replacement_usd"]
    extra = 0
    if hydro and t == "river":
        h = st["hydro_option"]
        solar = next(i["usd"] for i in st["capex_items"] if i["id"] == "solar")
        capex += h["hydro_capex_usd"] + h["reduced_solar_capex_usd"] - solar
        batt = h["battery_replacement_usd"]
        extra = h["extra_opex_usd_per_year"]
    capex *= st["logistics_multiplier"][t]
    life = C["life_years"]
    opex = capex * st["opex"]["maintenance_pct_of_capex_per_year"] * life + batt \
        + (st["opex"]["connectivity_usd_per_year"] + extra) * life
    return capex, opex


COST = {t: site_cost(t) for t in ("road", "river", "remote")}
COST_HYDRO = site_cost("river", hydro=True)

# ---------------- radio coverage sets ----------------
xy = np.c_[lon * np.cos(np.radians(lat)), lat] * KM_PER_DEG
tree = cKDTree(xy)
R = C["radio"]["radius_km"]
radio_sets = tree.query_ball_point(xy, r=R + 1e-6)

# ---------------- travel-time graph (minutes) on the 8-neighbour grid ----------------
tv = C["travel"]
speed = np.where(d_river <= tv["corridor_km"], tv["boat_kmh"],
                 np.where(d_road <= tv["corridor_km"], tv["road_kmh"], tv["foot_kmh"]))
_rows, _cols, _w = [], [], []
for di in (-1, 0, 1):
    for dj in (-1, 0, 1):
        if di == dj == 0:
            continue
        for k in range(n):
            g = idx[k] + di * nx + dj
            j = pos.get(int(g))
            if j is None:
                continue
            dist = math.hypot(dj * math.cos(math.radians(lat[k])), di) * res * KM_PER_DEG
            t = 0.5 * dist / speed[k] * 60 + 0.5 * dist / speed[j] * 60
            _rows.append(k); _cols.append(j); _w.append(t)
G = coo_matrix((_w, (_rows, _cols)), shape=(n, n)).tocsr()
cand = np.nonzero(access)[0]


def reach(ids, limit_min, batch=500, times=False):
    """{cell: cells within limit_min of it} (and their travel minutes when times=True)."""
    out = {}
    for s in range(0, len(ids), batch):
        part = ids[s:s + batch]
        D = dijkstra(G, indices=part, limit=limit_min)
        for r_, k in enumerate(part):
            hit = np.nonzero(D[r_] <= limit_min)[0]
            out[int(k)] = (hit, D[r_][hit]) if times else hit
    return out
