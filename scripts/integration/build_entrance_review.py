#!/usr/bin/env python3
"""
Phase 3: entrance review. READ-ONLY on the source GeoJSON. Writes integration/entrance_review.json.
usage: build_entrance_review.py <uploads_dir> <integration_dir> <indoor_building_dir>
Every row of entrances_ramps.geojson is reviewed; original source values are copied verbatim.
"""
import json, math, sys, os, hashlib
from pyproj import Transformer
from shapely.geometry import Polygon, Point
from shapely.ops import nearest_points

UP, OUT, IND = sys.argv[1:4]
SNAP_OK_M, SNAP_MAX_M = 3.0, 15.0           # review thresholds chosen by the auditor; adjustable, not survey facts
# explicit name -> building polygon (OSM way id). 'Academic' means H - Academic Building (NOT 'Academic Learning Center').
NAME_MAP = {"Academic": "way/225446888", "Design 2": "way/225491447", "Design2": "way/225491447",
            "Engineering Technology Center": "way/225446894", "West Parking Deck": "way/246651526", "Science Lab Annex": "way/1134398612"}
BID = {"way/225446888": "BLD001", "way/225491447": "BLD002", "way/225446894": "BLD003"}
INDOOR_LINK = {"ENT006": "entrance_1", "ENT007": "entrance_2", "RMP004": "entrance_3"}   # indoor entrances placed from these source rows

src_entr = json.load(open(f"{UP}/entrances_ramps.geojson")); src_b = json.load(open(f"{UP}/buildings.geojson")); src_s = json.load(open(f"{UP}/sidewalks.geojson"))
sha = {f: hashlib.sha256(open(f"{UP}/{f}", "rb").read()).hexdigest() for f in ("buildings.geojson", "entrances_ramps.geojson", "sidewalks.geojson")}
polys = {f["properties"]["id"]: f for f in src_b["features"] if f["properties"].get("id") in set(NAME_MAP.values())}
ref = polys["way/225446888"]["geometry"]["coordinates"][0]
clon = sum(c[0] for c in ref) / len(ref); clat = sum(c[1] for c in ref) / len(ref)
ENU = f"+proj=aeqd +lat_0={clat} +lon_0={clon} +datum=WGS84 +units=m"      # one local metric frame for the whole campus
t_ll2m = Transformer.from_crs("EPSG:4326", ENU, always_xy=True); t_m2ll = Transformer.from_crs(ENU, "EPSG:4326", always_xy=True)
t_3857 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
FP = {k: Polygon([t_ll2m.transform(*c) for c in v["geometry"]["coordinates"][0]]) for k, v in polys.items()}
ways = [(f["properties"]["id"], f["properties"].get("highway"), [t_ll2m.transform(*c) for c in f["geometry"]["coordinates"]]) for f in src_s["features"]]
from shapely.geometry import LineString
WL = [(i, h, LineString(c)) for i, h, c in ways]

def side(poly, q):
    c = poly.centroid; a = math.degrees(math.atan2(q.y - c.y, q.x - c.x))
    return ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][int(((a + 22.5) % 360) // 45)]

rows = []
for idx, f in enumerate(src_entr["features"]):
    p = f["properties"]; x, y = f["geometry"]["coordinates"]
    lon, lat = t_3857.transform(x, y); pt = Point(t_ll2m.transform(lon, lat))
    way = NAME_MAP.get(p["building_name"]); poly = FP.get(way)
    issues, rec = [], {}
    if p["feature_id"] == "ENT" and p["feature_type"] == "008": issues.append("shifted_row: feature_id='ENT', feature_type='008', fid=null")
    if p["building_name"] == "Design2": issues.append("name_typo: 'Design2' (matched to 'Design 2' / I2 - Design 2 Building)")
    if p.get("source") == "KSU Accessiblity Map": issues.append("source_typo: 'Accessiblity'")
    rec.update(source_row_index=idx, source=dict(properties=p, geometry=f["geometry"], crs="EPSG:3857"),
               original_coordinates=dict(epsg3857=[x, y], lon=round(lon, 8), lat=round(lat, 8)))
    if poly is None:
        rec.update(building_polygon=None, building_id=None, snap=None); status = "needs_verification"; issues.append("no building polygon matched")
    else:
        inside = poly.contains(pt); d_bound = poly.exterior.distance(pt)
        q = nearest_points(poly.exterior, pt)[0]; qlon, qlat = t_m2ll.transform(q.x, q.y)
        wd = sorted(((l.distance(pt), i, h) for i, h, l in WL))[:3]
        within = d_bound <= SNAP_MAX_M
        rec.update(building_polygon=way, building_id=BID.get(way),
                   nearest_boundary_point=dict(lon=round(qlon, 8), lat=round(qlat, 8), wall_side=side(poly, q)),
                   distance_original_to_boundary_m=round(d_bound, 2), original_inside_footprint=bool(inside),
                   proposed_snap=(dict(lon=round(qlon, 8), lat=round(qlat, 8), snap_distance_m=round(d_bound, 2), method="nearest point on the building exterior ring (geodesic-local aeqd frame)",
                                       note="PROPOSED position only; a nearest wall point is not a verified door location.") if within else None),
                   nearest_sidewalk_ways_to_original=[dict(osm_way=i, highway=h, distance_m=round(dd, 1)) for dd, i, h in wd])
        if d_bound > 1000:
            issues.append(f"the polygon matched by name is {d_bound/1000:.1f} km away: most likely a same-named building on another campus, so the Marietta building is NOT identified; no snap proposed")
            rec.update(building_polygon=None, building_id=None, nearest_boundary_point=None, proposed_snap=None, nearest_sidewalk_ways_to_original=[])
            rec["distance_original_to_boundary_m"] = None; rec["rejected_name_match"] = way
        elif not within: issues.append(f"original point is {d_bound:.1f} m from the footprint (> {SNAP_MAX_M} m): no snap proposed")
        status = "source_supported" if d_bound <= SNAP_OK_M else ("corrected_pending_review" if within else "needs_verification")
    if "shifted_row: feature_id='ENT', feature_type='008', fid=null" in issues:
        status = "corrected_pending_review" if status != "needs_verification" else "needs_verification"
        rec["proposed_row_correction"] = dict(feature_id="ENT008", feature_type="entrance", fid=13, confidence="medium",
            evidence=["ENT001-ENT007 are sequential entrances; the ramps use a separate RMP001-RMP005 sequence", "the row's building (Engineering Technology Center), accessible=true, source and verified=false match the neighbouring entrance rows",
                      "feature_type values elsewhere are the words 'entrance'/'ramp', so '008' looks like the numeric part of the id", "fid is null while fid 1-12 are used (hand-added row)"],
            action="Proposed only. Source file is NOT edited. Confirm with the QGIS author and in the field.")
    indoor = None
    if rec["building_id"] == "BLD001":
        ent = INDOOR_LINK.get(p["feature_id"])
        if ent: indoor = ent
    rec.update(feature_id=p["feature_id"], feature_type=p["feature_type"], review_status=status, requires_field_verification=True,
               supported_by_original_source=True, source_verified_flag=p["verified"], source_accessible_flag=p["accessible"],
               issues=issues, indoor_entrance_feature=indoor)
    rows.append(rec)

# --- compare the indoor entrance nodes (synthetic) with the proposed snaps
features = json.load(open(f"{IND}/features.json"))["features"]; meta = json.load(open(f"{IND}/metadata.json"))
OX, OY, H = 150.0, 110.0, 90.0
lon0, lat0 = meta["georeference_hint"]["origin_lon"], meta["georeference_hint"]["origin_lat"]
ring = polys["way/225446888"]["geometry"]["coordinates"][0]
# indoor local metres -> campus ENU through a similarity fit of the 25 footprint vertices (no reliance on the generator's degree constants)
import numpy as np
svg_pts = json.load(open(f"{IND}/../../shared/buildings.json"))["buildings"][0]["exterior_footprint"]["coordinates"][0][:-1]
A = np.array([[(sx - OX) / 10, H - (sy - OY) / 10] for sx, sy in svg_pts]); Bm = np.array([t_ll2m.transform(*c) for c in ring[:-1]])
ca, cb = A.mean(0), Bm.mean(0); Ac, Bc = A - ca, Bm - cb
U, S, Vt = np.linalg.svd(Ac.T @ Bc); Rm = (U @ Vt).T if np.linalg.det(U @ Vt) > 0 else None
if Rm is None: raise SystemExit("reflection in fit")
sc = S.sum() / (Ac ** 2).sum()
fit = lambda sx, sy: (sc * (Rm @ (np.array([(sx - OX) / 10, H - (sy - OY) / 10]) - ca)) + cb)
res = [float(np.hypot(*(fit(sx, sy) - b))) for (sx, sy), b in zip(svg_pts, Bm)]
fit_info = dict(method="similarity (scale+rotation+translation) fitted to the 25 footprint vertices", scale=round(float(sc), 5),
                rotation_deg=round(math.degrees(math.atan2(Rm[1, 0], Rm[0, 0])), 3), max_vertex_residual_m=round(max(res), 3), rms_residual_m=round(float(np.sqrt(np.mean(np.square(res)))), 3))
inode = {e["feature_id"]: e for e in features["entrances"]}
for r in rows:
    r["indoor_entrance_comparison"] = None
    if r["indoor_entrance_feature"]:
        e = inode[r["indoor_entrance_feature"]]; ex, ey = fit(e["x"], e["y"])
        if r.get("proposed_snap"):
            sx_, sy_ = t_ll2m.transform(r["proposed_snap"]["lon"], r["proposed_snap"]["lat"])
            r["indoor_entrance_comparison"] = dict(indoor_feature=e["feature_id"], indoor_node=e["node_id"], offset_to_proposed_snap_m=round(math.hypot(ex - sx_, ey - sy_), 2),
                                                   note="indoor entrance position was chosen synthetically along the wall; it is NOT a surveyed door")
extra = dict(feature_id="entrance_4 (indoor, synthetic)", review_status="synthetic_demo", requires_field_verification=True, supported_by_original_source=False,
             building_id="BLD001", indoor_entrance_feature="entrance_4", issues=["invented for demonstration (standard entrance with steps)", "NOT in any source data", "must never be used as a real outdoor connection"],
             original_coordinates=None, proposed_snap=None)
by = {}
for r in rows: by[r["review_status"]] = by.get(r["review_status"], 0) + 1
by["synthetic_demo"] = 1
doc = dict(schema_version="1.0.0", description="Entrance review. Source data is preserved verbatim; proposed corrections are separate and unapproved.",
           source_sha256=sha, thresholds=dict(source_supported_max_snap_m=SNAP_OK_M, no_snap_beyond_m=SNAP_MAX_M, note="auditor-chosen review thresholds, not survey facts"),
           status_definitions=dict(source_supported="source row is well-formed and its point lies <= 3 m from its building footprint. Still unverified in the field.",
               corrected_pending_review="a correction (snap to the wall and/or a fixed row identity) is PROPOSED and waits for human review.",
               needs_verification="the source point cannot be placed confidently (building not matched or > 15 m away): no snap is proposed.",
               synthetic_demo="invented for the indoor demo; not a real entrance."),
           indoor_to_campus_fit=fit_info, status_counts=by, entrances=rows + [extra])
json.dump(doc, open(f"{OUT}/entrance_review.json", "w"), indent=1, ensure_ascii=False)
print("status counts:", by); print("fit:", fit_info)
for r in rows:
    s = r.get("proposed_snap")
    print(f"{r['feature_id']:7s}{str(r['feature_type']):9s}{str(r['building_id']):7s} d_boundary={r.get('distance_original_to_boundary_m')} status={r['review_status']:26s} snap={'yes' if s else 'no '} issues={len(r['issues'])}"
          + (f" indoor_offset={r['indoor_entrance_comparison']['offset_to_proposed_snap_m']}" if r["indoor_entrance_comparison"] else ""))
