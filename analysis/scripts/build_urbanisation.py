"""
Who lives where, by settlement type: urban centres, towns and peri-urban clusters, and rural areas.

Method: the Degree of Urbanisation (UN Statistical Commission 2020; GHSL) applied to WorldPop 2020 1 km
(UN-adjusted) inside the basin outline:
  urban centre   contiguous 1 km cells (4-neighbour) of >= 1,500 people/km2 adding up to >= 50,000 people
  urban cluster  contiguous cells (4-neighbour) of >= 300 people/km2 adding up to >= 5,000 people, not in a centre
  rural          everything else
The full method also fills gaps and smooths centres; this simplified form is labelled a modeled proxy.
The shares are applied to each year's basin total in population.json (assumption: shares hold to 2041; cities in
fact grow faster, so 2041 understates the urban share).

Also counts the settled 1 km cells (>= 5 people) outside urban centres: the reason a 1 km grid cannot count
village speakers (Stage 3 needs settlement data).

Outputs data/urbanisation.json.
"""
import glob, json, os, sys
import numpy as np, rasterio
from rasterio.features import geometry_mask
from rasterio.merge import merge
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
RAW = os.path.join(HERE, "..", "raw", "worldpop")
FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])


def load_worldpop():
    """WorldPop 2020 1 km inside the basin: people per pixel, the raster transform and each pixel's km2."""
    files = sorted(glob.glob(os.path.join(RAW, "*.tif")))
    if not files:
        sys.exit("WorldPop rasters not found in raw/worldpop (see analysis/README.md)")
    basin = json.load(open(os.path.join(DATA, "basin.geojson")))
    geoms = [f["geometry"] for f in basin["features"]]
    arr, tr = merge([rasterio.open(f) for f in files], nodata=0)
    a = np.where(arr[0] > 0, arr[0], 0).astype(np.float64)
    a[geometry_mask(geoms, out_shape=a.shape, transform=tr)] = 0
    lat = tr.f + (np.arange(a.shape[0]) + 0.5) * tr.e
    km2 = (abs(tr.e) * 110.57) * (abs(tr.a) * 111.32 * np.cos(np.radians(lat)))[:, None] * np.ones((1, a.shape[1]))
    return a, tr, km2


def classify(a, km2):
    """Masks (urban centre, town or peri-urban cluster) and the centres' labels and populations."""
    dens = np.divide(a, km2, out=np.zeros_like(a), where=km2 > 0)
    lab, n = ndimage.label(dens >= 1500, structure=FOUR)
    cp = ndimage.sum(a, lab, index=np.arange(1, n + 1))
    centre_ids = np.nonzero(cp >= 50_000)[0] + 1
    centre = np.isin(lab, centre_ids)
    labu, nu = ndimage.label(dens >= 300, structure=FOUR)
    up = ndimage.sum(a, labu, index=np.arange(1, nu + 1))
    cluster = np.isin(labu, np.nonzero(up >= 5_000)[0] + 1) & ~centre
    return centre, cluster, lab, centre_ids, cp


def main():
    a, tr, km2 = load_worldpop()
    tot = a.sum()
    centre, cluster, lab, centre_ids, cp = classify(a, km2)
    rural = ~centre & ~cluster
    share = {"urban_centre": a[centre].sum() / tot, "town_periurban": a[cluster].sum() / tot, "rural": a[rural].sum() / tot}

    # the largest centres, by population, with a representative point
    centres = []
    for cid, p in sorted(zip(centre_ids, cp[centre_ids - 1]), key=lambda x: -x[1])[:40]:
        rows, cols = np.nonzero(lab == cid)
        k = np.argmax(a[rows, cols])
        lon, latc = tr * (cols[k] + 0.5, rows[k] + 0.5)
        centres.append({"lon": round(lon, 3), "lat": round(latc, 3), "pop_2020": int(p), "km2": round(float(km2[rows, cols].sum()))})

    P = json.load(open(os.path.join(DATA, "population.json")))
    years = {str(y): float(np.sum(P["pop"][str(y)])) for y in P["years"]}
    settled = (a >= 5) & ~centre
    out = {
        "_note": "Modeled proxy: a simplified Degree of Urbanisation on WorldPop 2020 1 km inside the basin. Shares are held "
                 "constant to 2041 (assumption; cities grow faster, so the urban share is understated).",
        "_method": __doc__.strip(),
        "worldpop_2020_basin": int(tot),
        "share_2020": {k: round(float(v), 4) for k, v in share.items()},
        "by_year": {y: {"total": int(t), **{k: int(t * v) for k, v in share.items()}} for y, t in years.items()},
        "denominators": {
            "all": "All basin residents",
            "rural_periurban": "Rural plus towns and peri-urban (outside urban centres of 50k+): the design case",
            "ranger_served": "Ranger-served area: computed with the stations in Stage 4",
        },
        "urban_centres": {"count": int(len(centre_ids)), "largest": centres},
        "settled_cells_outside_centres": {"count": int(settled.sum()), "share_of_people": round(float(a[settled].sum() / tot), 4)},
    }
    with open(os.path.join(DATA, "urbanisation.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"basin {tot/1e6:.1f}M (2020): centres {share['urban_centre']:.1%} ({len(centre_ids)}), towns/peri-urban "
          f"{share['town_periurban']:.1%}, rural {share['rural']:.1%}; settled 1 km cells outside centres {settled.sum():,}")
    print("2041:", out["by_year"]["2041"])


if __name__ == "__main__":
    main()
