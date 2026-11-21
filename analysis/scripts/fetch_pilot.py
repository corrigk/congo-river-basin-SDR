"""
Terrain and canopy for the pilot area (Mbandaka, brief v3 §14.1), read as windows from two cloud-optimised GeoTIFFs
with HTTP range requests: only the window's bytes are transferred.

  dem.tif     Copernicus GLO-30 DSM (ESA / Airbus, Copernicus DEM licence: free use with attribution), tile N00 E018,
              from AWS open data (no account). A surface model: over forest it sits near the canopy top.
  canopy.tif  ETH Global Canopy Height 2020, 10 m (Lang et al. 2023, CC BY 4.0), tile N00E018.

Writes raw/pilot/dem.tif and raw/pilot/canopy.tif (not committed). Bare ground is later taken as DSM minus canopy
height (a modeled proxy).
"""
import os
from urllib.parse import quote
import rasterio
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw", "pilot")
PILOT = {"name": "Mbandaka", "lon0": 18.0, "lon1": 18.7, "lat0": 0.0, "lat1": 0.6}
SOURCES = {
    "dem.tif": "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N00_00_E018_00_DEM/Copernicus_DSM_COG_10_N00_00_E018_00_DEM.tif",
    "canopy.tif": "https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs&files=ETH_GlobalCanopyHeight_10m_2020_N00E018_Map.tif",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
               GDAL_HTTP_MULTIRANGE="YES", VSI_CACHE="TRUE")
    with rasterio.Env(**env):
        for name, url in SOURCES.items():
            if os.path.exists(os.path.join(OUT, name)):
                print(f"{name}: already read"); continue
            # a URL with a query string needs GDAL's /vsicurl?url= form
            path = f"/vsicurl?use_head=no&list_dir=no&url={quote(url, safe='')}" if "?" in url else f"/vsicurl/{url}"
            with rasterio.open(path) as src:
                win = from_bounds(PILOT["lon0"], PILOT["lat0"], PILOT["lon1"], PILOT["lat1"], src.transform).round_offsets().round_lengths()
                a = src.read(1, window=win)
                prof = src.profile.copy()
                prof.update(width=a.shape[1], height=a.shape[0], transform=src.window_transform(win), driver="GTiff", compress="deflate", tiled=True,
                            blockxsize=256, blockysize=256)
                prof.pop("interleave", None)
                with rasterio.open(os.path.join(OUT, name), "w", **prof) as dst:
                    dst.write(a, 1)
                print(f"{name}: {a.shape[1]} x {a.shape[0]} px at {abs(src.transform.a) * 111320:.0f} m, {a.dtype}, min {a.min()} max {a.max()}; "
                      f"saved {os.path.getsize(os.path.join(OUT, name)) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
