# Reference material

- `georeferencing/`: our QGIS ground control points (`.points`) and the GDAL `.aux.xml` sidecars for georeferencing KSU's Marietta accessibility map. These were used to hand-digitize `data/outdoor/source/entrances_ramps.geojson`.
- `ksu_maps/`: **not in the public repository** (git-ignored). Kennesaw State University's published accessibility and parking maps (PDF), a JPG export, and the georeferenced `KSU Marietta Campus_Accessibility Map_modified.tif`. No licence permitting redistribution was found. Get them from KSU directly and place them here to use the QGIS raster layer.

  The QGIS project (`data/outdoor/source/Navigation.qgz`) looks for the TIF at `data/outdoor/source/maps/`. Copy it there if you want that layer to load.
