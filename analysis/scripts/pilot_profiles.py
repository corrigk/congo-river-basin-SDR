"""
Sound profiles over real terrain and canopy in the pilot area (Mbandaka; brief v3 §5.5): how far a village speaker
is heard along 12 bearings, with the ground, the canopy and the speaker on its mast.

Inputs: raw/pilot/dem.tif (Copernicus GLO-30 DSM) and raw/pilot/canopy.tif (ETH canopy height 2020, 10 m) from
fetch_pilot.py; the GRID3 blocks (build_settlements.py) for where the pilot's speakers go.

Per bearing, every 20 m out to 2 km:
  ground       DSM minus canopy height, smoothed with a 300 m running median (MODELED PROXY for bare ground: the two
               datasets disagree by several metres cell to cell, so the raw difference is noise on flat land)
  canopy top   ground plus the canopy height
  path         straight line from the speaker (mast above its ground) to a listener 1.5 m above the ground
  forest loss  forest attenuation x metres of that line below the canopy top where the canopy is over 3 m
  barrier      10 dB where the ground blocks the line (FEMA: up to 20)
  level        L0 - D log2(r / r0) - air (r - r0) - forest loss - barrier   (acoustic_params.json base values)
  heard to     the distance out to which the level stays at or above the night threshold (65 dB)

Outputs data/profiles_pilot.json: the 12 profiled speakers with their bearings, and the pilot's speaker count.
"""
import json, os, math
import numpy as np
import rasterio
from scipy.ndimage import median_filter
from site_speakers import greedy_blocks, village_radius, AP, R0
from build_urbanisation import load_worldpop, classify

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
PIL = os.path.join(HERE, "..", "raw", "pilot")
BLOCKS = os.path.join(HERE, "..", "raw", "grid3", "blocks.npz")
BOX = {"name": "Mbandaka", "lon0": 18.0, "lon1": 18.7, "lat0": 0.0, "lat1": 0.6}
STEP, MAXR, NB, NSPK = 20.0, 2000.0, 12, 12
v = lambda k: AP[k]["base"]


def main():
    dem = rasterio.open(os.path.join(PIL, "dem.tif")); can = rasterio.open(os.path.join(PIL, "canopy.tif"))
    D, C = dem.read(1).astype(float), can.read(1).astype(float)
    C[C >= 255] = 0                                            # no data (water, gaps) counts as open
    def sample(src, arr, lon, lat):
        r, c = rasterio.transform.rowcol(src.transform, lon, lat)
        r = np.clip(np.asarray(r), 0, arr.shape[0] - 1); c = np.clip(np.asarray(c), 0, arr.shape[1] - 1)
        return arr[r, c]

    # the pilot's speakers, sited as basin-wide (site_speakers.py) on the GRID3 blocks inside the box
    B = np.load(BLOCKS)
    m = (B["lon"] >= BOX["lon0"]) & (B["lon"] <= BOX["lon1"]) & (B["lat"] >= BOX["lat0"]) & (B["lat"] <= BOX["lat1"])
    # as site_speakers.py: the 2020 pattern scaled to 2041, and urban-centre blocks left to phones and radio first
    P = json.load(open(os.path.join(DATA, "population.json")))
    a, tr, km2 = load_worldpop(); centre = classify(a, km2)[0]
    f = float(np.sum(P["pop"]["2041"])) / float(a.sum())
    bc, br = (~tr) * (B["lon"][m].astype(float), B["lat"][m].astype(float))
    bcen = centre[np.clip(np.floor(br).astype(int), 0, a.shape[0] - 1), np.clip(np.floor(bc).astype(int), 0, a.shape[1] - 1)]
    urban_pop = float((B["pop2020"][m].astype(float) * f)[bcen].sum())
    m[np.nonzero(m)[0][bcen]] = False
    lon, lat = B["lon"][m].astype(float), B["lat"][m].astype(float)
    pop, area = B["pop2020"][m].astype(float) * f, B["area_km2"][m].astype(float)
    xy = np.c_[lon * 111.32 * np.cos(np.radians(lat)), lat * 110.57]
    r_m = village_radius("base")
    ii, nn, hh, cov = greedy_blocks(xy, pop, area, r_m / 1000, v("t1_cutoff_people"))
    print(f"pilot: {m.sum():,} blocks outside urban centres, {pop.sum()/1e3:.0f}k people (2041; {urban_pop/1e3:.0f}k more in urban centres); "
          f"{nn.sum():,} speakers reach {hh.sum()/1e3:.0f}k (voice {r_m:.0f} m)")

    # 12 speakers to profile: the most-heard first, at least 5 km apart, so they span city, river and forest villages
    order = np.argsort(-hh); pick = []
    for j in order:
        if all(math.hypot(*(xy[ii[j]] - xy[ii[k]])) >= 5 for k in pick): pick.append(j)
        if len(pick) == NSPK: break

    L0, Dl, air, forest, bar = v("src_t1_db"), v("d_land_db"), v("air_db_km"), v("forest_db_100m"), 10.0
    thr = v("ambient_night_dba") + v("margin_db"); mast = v("mast_m")
    dist = np.arange(STEP, MAXR + 1, STEP)
    out = []
    for n_, j in enumerate(pick):
        s_lon, s_lat = lon[ii[j]], lat[ii[j]]
        g0 = None
        bearings = []
        for b in range(NB):
            th = math.radians(b * 360 / NB)
            plon = s_lon + dist * math.sin(th) / (111320 * math.cos(math.radians(s_lat)))
            plat = s_lat + dist * math.cos(th) / 110570
            plon, plat = np.r_[s_lon, plon], np.r_[s_lat, plat]
            raw = sample(dem, D, plon, plat) - sample(can, C, plon, plat)
            ground = median_filter(raw, size=15, mode="nearest")
            ch = sample(can, C, plon, plat)
            if g0 is None: g0 = ground[0]
            zs = ground[0] + mast
            ground, ch = ground[1:], ch[1:]; top = ground + ch
            spl = np.empty(len(dist)); fpath = np.zeros(len(dist), int); blk = np.zeros(len(dist), int)
            for i in range(len(dist)):
                k = np.arange(i + 1)
                zl = ground[i] + 1.5
                line = zs + (zl - zs) * (k + 1) / (i + 1)       # height of the straight path above each sample
                under = (line < top[k]) & (ch[k] > 3)
                blocked = np.any(line[:-3] < ground[k][:-3] - 1)   # the ground in the way (not the listener's last 60 m)
                r = dist[i]; fpath[i] = int(under.sum() * STEP); blk[i] = int(blocked)
                spl[i] = L0 - Dl * math.log2(r / R0) - air * (r - R0) / 1000 - forest * under.sum() * STEP / 100 - (bar if blocked else 0)
            ok = spl >= thr
            heard = float(dist[np.argmin(ok)] - STEP) if not ok.all() else float(MAXR)
            if not ok[0]: heard = 0.0
            # per sample: ground and canopy (m, relative to the speaker's ground), metres of the path under the canopy, ground in the way
            bearings.append({"deg": int(b * 360 / NB), "ground_m": np.round(ground - g0, 1).tolist(), "canopy_m": np.round(ch).astype(int).tolist(),
                             "forest_path_m": fpath.tolist(), "blocked": blk.tolist(), "heard_m": heard,
                             "forest_share": round(float(((ch > 3)).mean()), 2)})
        hd = [b["heard_m"] for b in bearings]
        out.append({"id": n_, "lon": round(float(s_lon), 5), "lat": round(float(s_lat), 5), "mast_m": mast, "heard_people": int(hh[j]),
                    "site_canopy_m": round(float(sample(can, C, s_lon, s_lat)), 1), "bearings": bearings,
                    "heard_m": {"min": min(hd), "median": float(np.median(hd)), "max": max(hd)}})
        print(f"  speaker {n_}: {s_lon:.3f},{s_lat:.3f} reaches {hh[j]:,.0f} people; heard {min(hd):.0f}-{max(hd):.0f} m (median {np.median(hd):.0f})")
    allh = [b["heard_m"] for s in out for b in s["bearings"]]
    res = {
        "_note": "Sound profiles over Copernicus GLO-30 terrain and ETH canopy height in the pilot area. Bare ground = DSM minus canopy height (modeled proxy).",
        "_method": __doc__.strip(), "r0_m": R0,
        "pilot": BOX, "step_m": STEP, "max_m": MAXR, "threshold_db": {"day": v("ambient_village_day_dba") + v("margin_db"), "night": thr, "indoor": thr + v("building_open_db")},
        "params": {"L0": L0, "D": Dl, "air": air, "forest_db_100m": forest, "barrier_db": bar, "mast_m": mast, "listener_m": 1.5},
        "pilot_speakers": int(nn.sum()), "pilot_people_reached": int(hh.sum()), "pilot_people": int(pop.sum()), "pilot_urban_people": int(urban_pop),
        "heard_m": {"min": min(allh), "median": float(np.median(allh)), "max": max(allh), "flat_model": round(r_m)},
        "sources": ["Copernicus GLO-30 DSM (ESA / Airbus)", "ETH Global Canopy Height 2020 (Lang et al. 2023, CC BY 4.0)", "GRID3 COD Settlement Extents v4.0 (CC BY-SA 4.0)"],
        "speakers": out,
    }
    with open(os.path.join(DATA, "profiles_pilot.json"), "w") as fh:
        json.dump(res, fh, separators=(",", ":"))
    print(f"all bearings: heard {min(allh):.0f}-{max(allh):.0f} m, median {np.median(allh):.0f} m (flat model: {r_m:.0f} m); "
          f"profiles_pilot.json {os.path.getsize(os.path.join(DATA, 'profiles_pilot.json'))/1e3:.0f} kB")


if __name__ == "__main__":
    main()
