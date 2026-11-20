"""
Settlement blocks for the DRC from GRID3 COD Settlement Extents v4.0 (CIESIN / GRID3, CC BY-SA 4.0;
raw/grid3/grid3_cod_settlement_extents_v4.gpkg, about 912 MB, not committed).

GRID3 gives 1.15M settlement blocks (built-up area, small settlement area, hamlet) with building counts but no
population. People per block = buildings x people per building, calibrated per grid cell (0.125 deg, population.json):
each DRC cell's WorldPop 2020 people are shared among its buildings, capped at MAX_PPB people a building (assumption);
anything above the cap stays as "outside the mapped settlements". Calibrating per 14 km cell, not per 1 km pixel,
matters: WorldPop spreads people smoothly across pixels, GRID3 puts them at the buildings, and per-pixel sharing left
half the DRC's people in pixels with no block.

Positions are each block's bounding-box centre, read from the GeoPackage's spatial index (no geometry parsing).

Writes raw/grid3/blocks.npz (derived, not committed): lon, lat, area_km2, buildings, type (0 built-up, 1 small
settlement, 2 hamlet), cell (index into population.json cells), pop2020; plus, per DRC cell, the people outside blocks.
"""
import os, sqlite3, math, json
import numpy as np
from shapely import contains_xy
from shapely.geometry import shape
from build_urbanisation import load_worldpop

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw", "grid3")
DATA = os.path.join(HERE, "..", "data")
GPKG = os.path.join(RAW, "grid3_cod_settlement_extents_v4.gpkg")
TYPES = {"Built-up Area": 0, "Small Settlement Area": 1, "Hamlet": 2}
MAX_PPB = 15  # people per building at most (assumption; DRC households average about 5 people)
R = 6378137.0


def main():
    con = sqlite3.connect(GPKG)
    t = "grid3_cod_settlement_extents_v4"
    rows = con.execute(f'select r.minx, r.maxx, r.miny, r.maxy, b.building_count, b.extent_type, b.block_area_sqm '
                       f'from "{t}" b join "rtree_{t}_geom" r on r.id = b.fid').fetchall()
    a = np.array([r[:5] for r in rows], float)
    typ = np.array([TYPES.get(r[5], 2) for r in rows], np.int8)
    area = np.array([r[6] for r in rows], float) / 1e6
    x, y = (a[:, 0] + a[:, 1]) / 2, (a[:, 2] + a[:, 3]) / 2
    lon = np.degrees(x / R)
    lat = np.degrees(2 * np.arctan(np.exp(y / R)) - math.pi / 2)
    # web-mercator area is inflated by 1/cos^2(lat): bring block areas back to ground km2
    area = area * np.cos(np.radians(lat)) ** 2
    bld = a[:, 4]
    print(f"GRID3: {len(rows):,} blocks, {int(bld.sum()):,} buildings")

    basin = shape(json.load(open(os.path.join(DATA, "basin.geojson")))["features"][0]["geometry"])
    inb = contains_xy(basin, lon, lat)
    lon, lat, area, bld, typ = lon[inb], lat[inb], area[inb], bld[inb], typ[inb]
    print(f"inside the basin: {inb.sum():,} blocks, {int(bld.sum()):,} buildings")

    # grid cell of each block (population.json), and WorldPop 2020 people per cell
    P = json.load(open(os.path.join(DATA, "population.json")))
    nx, res, lon0, lat0 = P["nx"], P["res_deg"], P["lon0"], P["lat0"]
    cells = np.array(P["cells"]["i"]); pos = {int(g): k for k, g in enumerate(cells)}
    gidx = lambda lo, la: np.floor((la - lat0 + res / 2) / res).astype(int) * nx + np.floor((lo - lon0 + res / 2) / res).astype(int)
    kc = np.array([pos.get(int(g), -1) for g in gidx(lon, lat)])
    ok = kc >= 0
    lon, lat, area, bld, typ, kc = lon[ok], lat[ok], area[ok], bld[ok], typ[ok], kc[ok]
    wp, tr, km2 = load_worldpop()
    rr, cc = np.nonzero(wp > 0)
    plon, plat = tr * (cc + 0.5, rr + 0.5)
    pk = np.array([pos.get(int(g), -1) for g in gidx(plon, plat)])
    cellpop = np.bincount(pk[pk >= 0], weights=wp[rr, cc][pk >= 0], minlength=len(cells))
    drc = np.array(P["cells"]["country"]) == "COD"
    w = np.maximum(bld, 0.0)
    cellb = np.bincount(kc, weights=w, minlength=len(cells))
    ppb = np.where(cellb > 0, np.minimum(MAX_PPB, cellpop / np.where(cellb > 0, cellb, 1)), 0.0)
    pop = w * ppb[kc]
    outside = np.where(drc, np.maximum(0.0, cellpop - np.bincount(kc, weights=pop, minlength=len(cells))), 0.0)
    np.savez_compressed(os.path.join(RAW, "blocks.npz"), lon=lon.astype(np.float32), lat=lat.astype(np.float32),
                        area_km2=area.astype(np.float32), buildings=bld.astype(np.int32), type=typ, cell=kc.astype(np.int32),
                        pop2020=pop.astype(np.float32), outside_cell=outside.astype(np.float32), drc_cell=drc)
    d = drc.sum()
    print(f"DRC cells {d:,}: WorldPop 2020 {cellpop[drc].sum()/1e6:.1f}M; in GRID3 blocks {pop.sum()/1e6:.1f}M, outside the mapped settlements {outside.sum()/1e6:.1f}M; "
          f"median {np.median(ppb[drc & (cellb > 0)]):.1f} people per building, cells at the {MAX_PPB} cap: {(ppb[drc] >= MAX_PPB).sum()}")
    for k, v in TYPES.items():
        m = typ == v
        print(f"  {k:22s} {m.sum():>9,} blocks  {pop[m].sum()/1e6:5.1f}M people  median {np.median(pop[m]):.0f} per block, {np.median(area[m]):.3f} km2")


if __name__ == "__main__":
    main()
