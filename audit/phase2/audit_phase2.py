#!/usr/bin/env python3
"""
Independent audit of indoor-mapping/ (does NOT import the package's own validator or generator).
Reads raw files only. Writes audit/phase2_results.json. Never modifies the package or the uploads.
"""
import json, math, os, re, collections, itertools, hashlib, subprocess, sys
import xml.etree.ElementTree as ET
import networkx as nx
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from pyproj import Transformer

PKG = "/mnt/user-data/outputs/indoor-mapping"
UP = "/mnt/user-data/uploads"
BD = f"{PKG}/buildings/BLD001"
OUT = "/mnt/user-data/outputs/audit"
J = lambda p: json.load(open(p))
rooms = J(f"{BD}/rooms.json")["rooms"]; nodes = J(f"{BD}/nodes.json")["nodes"]; edges = J(f"{BD}/edges.json")["edges"]
conns = J(f"{BD}/connections.json")["connections"]; obsf = J(f"{BD}/obstacles.json"); feats = J(f"{BD}/features.json")["features"]
connectors = J(f"{BD}/connectors.json")["connectors"]; meta = J(f"{BD}/metadata.json")
bjs = J(f"{PKG}/shared/buildings.json"); bidx = J(f"{PKG}/shared/building_index.json")
NID = {n["node_id"]: n for n in nodes}; EID = {e["edge_id"]: e for e in edges}
RID = {r["room_id"]: r for r in rooms}
OX, OY, SC, HH = 150.0, 110.0, 10.0, 90.0
m = lambda x, y: ((x - OX) / SC, HH - (y - OY) / SC)

R = []       # (section, id, description, status, detail)   status in PASS/FAIL/WARN/INFO
def rec(sec, cid, desc, ok, detail="", warn=False):
    st = "PASS" if ok else ("WARN" if warn else "FAIL")
    R.append((sec, cid, desc, st, str(detail)[:400]))
def info(sec, cid, desc, detail=""): R.append((sec, cid, desc, "INFO", str(detail)[:600]))

# ================================================================= 0. original data untouched
sha = {l.split()[1].split("/")[-1]: l.split()[0] for l in open("/tmp/orig_sha.txt")}
now = {f: hashlib.sha256(open(f"{UP}/{f}", "rb").read()).hexdigest() for f in sha}
rec("Provenance", "P-01", "Original GeoJSON files unchanged since first inspection (SHA-256)", now == sha, str(now == sha))

# ================================================================= 1. SVG audit
SV = {}
for f in (1, 2, 3):
    p = f"{BD}/floor_{f}.svg"
    xl = subprocess.run(["xmllint", "--noout", p], capture_output=True, text=True)
    rec("SVG", f"S-XML-F{f}", f"floor_{f}.svg is well-formed XML (xmllint)", xl.returncode == 0, xl.stderr[:150])
    root = ET.parse(p).getroot(); SV[f] = dict(root=root, by={}, ids=[])
    for e in root.iter():
        if e.get("id"): SV[f]["ids"].append(e.get("id")); SV[f]["by"][e.get("id")] = e
    txt = open(p).read()
    rec("SVG", f"S-SAFE-F{f}", f"floor_{f}.svg has no <script>, <image>, external URLs or event handlers",
        not re.search(r"<script|<image|<foreignObject|https?://(?!www\.w3\.org|c2pa\.org/manifest)|\son[a-z]+=", txt), "")
ns = "{http://www.w3.org/2000/svg}"
rec("SVG", "S-VB", "All floors share the same viewBox / width / height", len({(SV[f]["root"].get("viewBox"), SV[f]["root"].get("width"), SV[f]["root"].get("height")) for f in SV}) == 1,
    {f: SV[f]["root"].get("viewBox") for f in SV})
rec("SVG", "S-UNITS", "data-units-per-meter = 10 and data-origin = top-left on every floor",
    all(SV[f]["root"].get("data-units-per-meter") == "10" and SV[f]["root"].get("data-origin") == "top-left" for f in SV))
rec("SVG", "S-DUPID", "No duplicate ids inside any single SVG file", all(len(SV[f]["ids"]) == len(set(SV[f]["ids"])) for f in SV))
rec("SVG", "S-ROUTE", "Exactly one empty <g id=route_layer> per floor",
    all(SV[f]["ids"].count("route_layer") == 1 and len(list(SV[f]["by"]["route_layer"])) == 0 for f in SV))
# footprint vs raw GeoJSON (independent transform: azimuthal-equidistant ENU at the building, true-north aligned)
gj = J(f"{UP}/buildings.geojson")
feat = [f for f in gj["features"] if f["properties"].get("building_id") == "BLD001"][0]
ring = feat["geometry"]["coordinates"][0]
clon = sum(c[0] for c in ring) / len(ring); clat = sum(c[1] for c in ring) / len(ring)
tf = Transformer.from_crs("EPSG:4326", f"+proj=aeqd +lat_0={clat} +lon_0={clon} +datum=WGS84 +units=m", always_xy=True)
enu = [tf.transform(*c) for c in ring[:-1]]
minx, miny = min(p[0] for p in enu), min(p[1] for p in enu)
def pp(d): return [tuple(map(float, q.split())) for q in re.findall(r"[ML]\s*([\-\d.]+ [\-\d.]+)", d)]
fp_paths = {f: SV[f]["by"]["footprint"].get("d") for f in SV}
rec("SVG", "S-FP-SAME", "Identical exterior footprint path on all 3 floors", len(set(fp_paths.values())) == 1)
svg_pts = [m(*q) for q in pp(fp_paths[1])]
dev = []
for (ex, ey) in svg_pts:
    # nearest raw vertex in local SW-origin frame
    dev.append(min(math.hypot(ex - (px - minx), ey - (py - miny)) for px, py in enu))
rec("SVG", "S-FP-RAW", "SVG footprint vertices match raw buildings.geojson polygon (independent ENU transform) within 0.25 m", len(svg_pts) == len(enu) and max(dev) < 0.25,
    f"{len(svg_pts)} vs {len(enu)} vertices; max deviation {max(dev):.3f} m", warn=True)
_phi = math.radians(clat); _mlat = 111132.92 - 559.82*math.cos(2*_phi) + 1.175*math.cos(4*_phi); _mlon = 111412.84*math.cos(_phi) - 93.5*math.cos(3*_phi)
_ky = _mlat/110574.0; _kx = _mlon/(111320.0*math.cos(math.radians(33.937)))
dev2 = [min(math.hypot(ex*_kx - (px-minx), ey*_ky - (py-miny)) for px, py in enu) for ex, ey in svg_pts]
rec("SVG", "S-FP-SCALE", "Deviation is explained by the generator's metres-per-degree constants (110574 m/deg lat is the equatorial value; ~110921 at this latitude)", max(dev2) < 0.12,
    f"after rescaling by x{_kx:.5f}, y{_ky:.5f}: max deviation {max(dev2):.3f} m (was {max(dev):.3f} m)")
ext = SV[1]["by"]["exterior_wall"].get("d"); rec("SVG", "S-FP-EXT", "Exterior wall path equals footprint path", ext == fp_paths[1])
# room ids <-> JSON (both directions)
for f in (1, 2, 3):
    fl = f"BLD001_F{f}"; by = SV[f]["by"]
    jr = {r["room_id"] for r in rooms if r["floor_id"] == fl}
    sr = {i for i in SV[f]["ids"] if re.fullmatch(r"room_\d{3}|hallway_\d+", i)}
    rec("SVG", f"S-ROOMS-F{f}", f"F{f}: SVG room_/hallway_ ids == JSON room ids (both directions)", jr == sr, f"json-only {sorted(jr-sr)[:4]} svg-only {sorted(sr-jr)[:4]}")
    lab = {i[6:] for i in SV[f]["ids"] if i.startswith("label_")}
    rec("SVG", f"S-LABEL-F{f}", f"F{f}: every non-hallway room has a label group", {r for r in jr if r.startswith("room_")} <= lab)
    rec("SVG", f"S-WALL-F{f}", f"F{f}: every room has an interior wall outline", all(f"wall_{r}" in by for r in jr if r.startswith("room_")))
    jd = {d["door_id"] for d in feats["doors"] if d["floor_id"] == fl}
    rec("SVG", f"S-DOOR-F{f}", f"F{f}: SVG door_* ids == features.json doors", jd == {i for i in SV[f]["ids"] if i.startswith("door_")})
    je = {e["feature_id"] for e in feats["entrances"] if e["floor_id"] == fl}; se = {i for i in SV[f]["ids"] if re.fullmatch(r"entrance_\d+", i)}
    rec("SVG", f"S-ENT-F{f}", f"F{f}: SVG entrance_* ids == features.json entrances", je == se, f"{sorted(je)} vs {sorted(se)}")
    jo = {"obstacle_" + o["obstacle_id"] for o in obsf["obstacles"] if o["floor_id"] == fl}
    rec("SVG", f"S-OBS-F{f}", f"F{f}: SVG obstacle_* ids == obstacles.json for that floor", jo == {i for i in SV[f]["ids"] if i.startswith("obstacle_")})
    jn = {"svgnode_" + n["node_id"] for n in nodes if n["floor_id"] == fl}
    rec("SVG", f"S-NODE-F{f}", f"F{f}: hidden nav-graph layer has one circle per node, at the node's x/y",
        jn == {i for i in SV[f]["ids"] if i.startswith("svgnode_")} and all(
            abs(float(by["svgnode_" + n["node_id"]].get("cx")) - n["x"]) < .01 and abs(float(by["svgnode_" + n["node_id"]].get("cy")) - n["y"]) < .01 for n in nodes if n["floor_id"] == fl))
    je2 = {"svgedge_" + e["edge_id"] for e in edges if e["floor_id"] == fl}
    rec("SVG", f"S-EDGE-F{f}", f"F{f}: hidden nav-graph layer has one line per edge", je2 == {i for i in SV[f]["ids"] if i.startswith("svgedge_")})
    jf = {x["feature_id"] for x in feats["fountains"] if x["floor_id"] == fl}
    rec("SVG", f"S-FOUN-F{f}", f"F{f}: fountain ids match", jf == {i for i in SV[f]["ids"] if re.fullmatch(r"fountain_\d+", i)})
    # <use> targets exist
    defs_ids = {e.get("id") for e in SV[f]["root"].iter() if e.get("id")}
    uses = [e.get("{http://www.w3.org/1999/xlink}href") or e.get("href") for e in SV[f]["root"].iter(ns + "use")]
    rec("SVG", f"S-USE-F{f}", f"F{f}: every <use> references an existing symbol", all(u and u.lstrip("#") in defs_ids for u in uses), f"{len(uses)} <use>")
    for need in ("elevator_1", "elevator_2", "stairwell_1", "stairwell_2"):
        if need not in by: rec("SVG", f"S-NAV-F{f}-{need}", f"F{f}: {need} present", False)
    # room polygon in svg == json polygon
    bad = []
    for r in rooms:
        if r["floor_id"] == fl:
            sp = [list(q) for q in pp(by[r["room_id"]].get("d"))]
            if sp != [list(map(float, q)) for q in r["polygon"]]: bad.append(r["room_id"])
    rec("SVG", f"S-POLY-F{f}", f"F{f}: SVG path geometry == rooms.json polygon", not bad, bad[:4])
# consistent x/y of vertical features across floors
for k in ("elevator_1", "elevator_2"):
    rr = {f: dict(SV[f]["by"][k].find(ns + "rect").attrib) for f in SV}
    rec("SVG", f"S-ALIGN-{k}", f"{k} rect identical on floors 1-3", rr[1] == rr[2] == rr[3])
# inline-embedding hazard (the guide recommends "one floor at a time")
alld = collections.Counter(i for f in SV for i in SV[f]["ids"])
dup = [i for i, c in alld.items() if c > 1]
info("SVG", "S-INLINE", "Ids duplicated if all three floors were inlined in one HTML document", f"{len(dup)} duplicate ids (e.g. {dup[:5]}) -> guide's 'one floor at a time' warning is correct")

# ---- C2PA manifest + reproducibility
c2 = {f: bool(re.search(r"<c2pa:manifest>", open(f"{BD}/floor_{f}.svg").read())) for f in (1, 2, 3)}
nonsvg = [p for p in subprocess.run(["grep", "-rIl", "-i", "c2pa", PKG], capture_output=True, text=True).stdout.split() if not p.endswith(".svg")]
info("Provenance", "P-C2PA", "SVG files carry an embedded C2PA Content Credentials manifest (<metadata>), ~7.7 KB each; not written by generate_indoor.py", f"svg floors: {c2}; non-SVG files containing 'c2pa': {nonsvg}")
os.makedirs("/tmp/regen/buildings/BLD001", exist_ok=True); os.makedirs("/tmp/regen/shared", exist_ok=True)
rg = subprocess.run(["python3", f"{PKG}/tools/generate_indoor.py", UP, "/tmp/regen"], capture_output=True, text=True)
rec("Provenance", "P-REGEN-RUN", "generate_indoor.py runs from the package into a TEMP folder (package untouched)", rg.returncode == 0, rg.stderr[-200:])
def strip(t): return re.sub(r"<metadata><c2pa:manifest>.*?</c2pa:manifest></metadata>", "", t, flags=re.S).replace(' xmlns:c2pa="http://c2pa.org/manifest"', "")
diffs = []
for rel in ["buildings/BLD001/" + n for n in ("rooms.json", "nodes.json", "edges.json", "connections.json", "obstacles.json", "connectors.json", "features.json", "metadata.json")] + ["shared/buildings.json", "shared/building_index.json"]:
    if open(f"{PKG}/{rel}").read() != open(f"/tmp/regen/{rel}").read(): diffs.append(rel)
for f in (1, 2, 3):
    rel = f"buildings/BLD001/floor_{f}.svg"
    if strip(open(f"{PKG}/{rel}").read()) != open(f"/tmp/regen/{rel}").read(): diffs.append(rel)
rec("Provenance", "P-REGEN-DIFF", "Delivered JSON and SVG files are byte-identical to a fresh generator run (SVGs compared after removing the C2PA block)", not diffs, diffs)

# ================================================================= 2. JSON audit (independent)
for name, items, key in (("rooms", rooms, "room_id"), ("nodes", nodes, "node_id"), ("edges", edges, "edge_id"), ("connections", conns, "connection_id"),
                         ("obstacles", obsf["obstacles"], "obstacle_id"), ("doors", feats["doors"], "door_id"), ("connectors", connectors, "connector_id")):
    ids = [i[key] for i in items]; rec("JSON", f"J-UNIQ-{name}", f"{name}: ids unique", len(ids) == len(set(ids)), len(ids))
rec("JSON", "J-UNIQ-feat", "features.json: ids unique per collection", all(len({x.get('feature_id') or x.get('door_id') for x in v}) == len(v) for v in feats.values()))
rec("JSON", "J-EDGE-REF", "Every edge references existing nodes", all(e["from_node"] in NID and e["to_node"] in NID for e in edges))
rec("JSON", "J-EDGE-SELF", "No self-loop or zero-length edges", all(e["from_node"] != e["to_node"] and e["distance"] > 0 for e in edges))
pairs = collections.Counter(frozenset((e["from_node"], e["to_node"])) for e in edges)
rec("JSON", "J-EDGE-DUP", "No duplicate edges between the same node pair", max(pairs.values()) == 1, [tuple(k) for k, v in pairs.items() if v > 1][:3])
rec("JSON", "J-EDGE-FLOOR", "Edges stay within one floor and match floor_id", all(NID[e["from_node"]]["floor_id"] == NID[e["to_node"]]["floor_id"] == e["floor_id"] for e in edges))
rec("JSON", "J-EDGE-DIST", "Edge distance == Euclidean node distance / 10 (+-0.01 m)", all(abs(math.hypot(NID[e["from_node"]]["x"] - NID[e["to_node"]]["x"], NID[e["from_node"]]["y"] - NID[e["to_node"]]["y"]) / SC - e["distance"]) <= .011 for e in edges))
SP = {"hallway": 1.2, "door": 1.0, "room_interior": 1.2, "entrance_threshold": 1.0, "elevator_door": 1.0, "stair_landing": 1.0, "ramp": 0.8, "entrance_steps": 0.4}
tt_bad = [e["edge_id"] for e in edges if abs(e["distance"] / (SP[e["edge_type"]] * (0.85 if e["potentially_narrow"] else 1)) - e["travel_time"]) > .011]
rec("JSON", "J-EDGE-TIME", "travel_time == distance / documented speed (x0.85 if narrow)", not tt_bad, tt_bad[:5])
rec("JSON", "J-EDGE-FLAGS", "Flag consistency: stairs_only edges are inaccessible; entrance_steps/stair_landing are stairs_only; ramp edges accessible",
    all((not e["accessible"]) for e in edges if e["stairs_only"]) and all(e["stairs_only"] for e in edges if e["edge_type"] in ("entrance_steps", "stair_landing"))
    and all(e["accessible"] for e in edges if e["edge_type"] == "ramp"))
rec("JSON", "J-NODE-FLOOR", "Node floor_id exists in metadata", all(n["floor_id"] in {f["floor_id"] for f in meta["floors"]} for n in nodes))
# coordinates vs footprint (raw geojson, independent frame)
Fraw = Polygon([(px - minx, py - miny) for px, py in enu])
off = []
for n in nodes:
    x, y = m(n["x"], n["y"]); d = Fraw.distance(Point(x, y)) if not Fraw.contains(Point(x, y)) else 0
    if d > 0.3: off.append((n["node_id"], round(d, 2)))
rec("JSON", "J-NODE-IN", "Every node inside (or <=0.3 m from) the footprint built from the RAW geojson", not off, off[:4])
ent_d = {n["node_id"]: round(Fraw.exterior.distance(Point(*m(n["x"], n["y"]))), 2) for n in nodes if n["node_type"] == "entrance"}
info("JSON", "J-ENT-ONWALL", "Entrance nodes: distance to raw footprint wall (m)", ent_d)
# destination nodes inside their rooms
RP = {r["room_id"]: Polygon([m(*q) for q in r["polygon"]]) for r in rooms}
bad = [n["node_id"] for n in nodes if n["node_type"] in ("destination", "restroom", "staircase") and not RP[n["room_id"]].buffer(0.02).contains(Point(*m(n["x"], n["y"])))]
rec("JSON", "J-DEST-IN", "Destination / restroom / staircase nodes lie inside their own room polygon", not bad, bad[:4])
bad = [n["node_id"] for n in nodes if n["node_type"] == "room_entrance" and RP[n["room_id"]].boundary.distance(Point(*m(n["x"], n["y"]))) > .3]
rec("JSON", "J-ENTR-WALL", "room_entrance nodes lie on their room's boundary", not bad, bad[:4])
nr = [r["room_id"] for r in rooms if r["navigable"]]
rec("JSON", "J-ROOM-ENTR", "Every navigable room: entrance_node_id & destination_node_id exist, entrance node belongs to the room, entrance has a door edge to a hallway/circulation node",
    all(RID[r]["entrance_node_id"] in NID and RID[r]["destination_node_id"] in NID and NID[RID[r]["entrance_node_id"]]["room_id"] == r and
        any(e["edge_type"] == "door" and RID[r]["entrance_node_id"] in (e["from_node"], e["to_node"]) for e in edges) for r in nr), f"{len(nr)} navigable rooms")
svc = [r for r in rooms if r["category"] == "service"]
rec("JSON", "J-SERVICE", "Non-navigable service rooms have no nodes (documented exception)", all(not [n for n in nodes if n["room_id"] == s["room_id"]] for s in svc), [s["room_id"] for s in svc])
# vertical connections
vb = []
for c in conns:
    a, b = NID.get(c["from_node"]), NID.get(c["to_node"])
    fa, fb = int(c["from_floor"][-1]), int(c["to_floor"][-1])
    if not (a and b and a["floor_id"] == c["from_floor"] and b["floor_id"] == c["to_floor"] and fb == fa + 1 and (a["x"], a["y"]) == (b["x"], b["y"])
            and a["node_type"] == b["node_type"] == ("elevator" if c["connection_type"] == "elevator" else "staircase")): vb.append(c["connection_id"])
rec("JSON", "J-CONN", "Vertical connections: valid nodes, adjacent floors, same type, same x/y", not vb, vb)
rec("JSON", "J-CONN-COUNT", "4 elevator + 4 stair connections (2 shafts x 2 floor hops each)", collections.Counter(c["connection_type"] for c in conns) == {"elevator": 4, "staircase": 4})
rec("JSON", "J-CONN-FLAGS", "Elevator: accessible, not stairs_only. Staircase: inaccessible, stairs_only", all(
    (c["accessible"] and not c["stairs_only"]) if c["connection_type"] == "elevator" else (not c["accessible"] and c["stairs_only"]) for c in conns))
rec("JSON", "J-CONN-ALLFLOORS", "Every elevator/stair node on floors 1-3 is covered by a connection",
    {n["node_id"] for n in nodes if n["node_type"] in ("elevator", "staircase")} == {x for c in conns for x in (c["from_node"], c["to_node"])})
# obstacles
ob_bad = []
for o in obsf["obstacles"]:
    ok = True
    if "location_node_id" in o: ok &= o["location_node_id"] in NID and NID[o["location_node_id"]]["floor_id"] == o["floor_id"]
    if "affected_edge_id" in o: ok &= o["affected_edge_id"] in EID and EID[o["affected_edge_id"]]["floor_id"] == o["floor_id"]
    ok &= all(n in NID for n in o.get("affected_node_ids", []))
    ok &= ("location_node_id" in o) or ("affected_edge_id" in o)
    if not ok: ob_bad.append(o["obstacle_id"])
rec("JSON", "J-OBS-REF", "Every obstacle references an existing node/edge on its own floor", not ob_bad, ob_bad)
sc_ids = {s["scenario_id"] for s in obsf["scenarios"]}
rec("JSON", "J-OBS-SCEN", "Scenario<->obstacle references are consistent in both directions",
    all(set(o["scenario_ids"]) <= sc_ids for o in obsf["obstacles"]) and all(
        (s["scenario_id"] in next(o for o in obsf["obstacles"] if o["obstacle_id"] == oid)["scenario_ids"]) for s in obsf["scenarios"] for oid in s["obstacle_ids"]))
rec("JSON", "J-OBS-SYNTH", "All obstacles synthetic and prefixed as demo data", all(o["synthetic"] and o["description"].startswith("SYNTHETIC DEMO DATA") for o in obsf["obstacles"]))
# synthetic / verified labelling
allrec = [*rooms, *nodes, *edges, *conns, *obsf["obstacles"], *connectors, *[x for v in feats.values() for x in v]]
rec("JSON", "J-SYNTH", "Every record: synthetic=true and verified=false (except obstacles that are explicitly verified demo data)",
    all(x.get("synthetic") is True for x in allrec) and all(x.get("verified") is False for x in [*rooms, *nodes, *edges, *conns, *connectors, *[y for v in feats.values() for y in v]]))
# metadata counts vs reality
cnt = meta["counts"]
rec("JSON", "J-META-COUNT", "metadata.json counts equal actual counts", cnt["nodes"] == len(nodes) and cnt["edges"] == len(edges) and cnt["vertical_connections"] == len(conns) and
    cnt["obstacles"] == len(obsf["obstacles"]) and cnt["scenarios"] == len(obsf["scenarios"]) and cnt["rooms"] == sum(r["category"] == "room" for r in rooms) and cnt["hallways"] == sum(r["category"] == "circulation" for r in rooms),
    f"metadata.rooms={cnt['rooms']} but rooms.json has {len(rooms)} records (rooms+service+hallways)")
info("JSON", "J-META-NOTE", "'rooms' count semantics", f"metadata.rooms counts category=='room' only ({cnt['rooms']}); rooms.json holds {len(rooms)} records incl. 3 service and 24 hallways")
rec("JSON", "J-META-OSM", "metadata.source.osm_id equals the raw feature's id", meta["source"]["osm_id"] == feat["properties"]["id"], meta["source"]["osm_id"])
rec("JSON", "J-INDEX", "building_index lists BLD001 generated, BLD002/BLD003 not generated", [(b["building_id"], b["indoor_generated"]) for b in bidx["buildings"]] == [("BLD001", True), ("BLD002", False), ("BLD003", False)])
# georeference hint round-trip (is the hint usable?)
gh = meta["georeference_hint"]
back = []
for (x, y), (lon, lat) in zip(svg_pts, ring[:-1]):
    lo = gh["origin_lon"] + x / gh["meters_per_degree_lon"]; la = gh["origin_lat"] + y / gh["meters_per_degree_lat"]
    bx, by_ = tf.transform(lo, la), tf.transform(lon, lat)
    back.append(math.hypot(bx[0] - by_[0], bx[1] - by_[1]))
rec("JSON", "J-GEOREF", "georeference_hint round-trips the footprint back to the raw lon/lat (<=0.25 m)", max(back) < .25, f"max error {max(back):.3f} m")
# graph connectivity / cut vertices
G = nx.Graph()
for e in edges: G.add_edge(e["from_node"], e["to_node"])
for c in conns: G.add_edge(c["from_node"], c["to_node"])
rec("JSON", "J-GRAPH-CONN", "Full indoor graph is one connected component", nx.is_connected(G), f"{G.number_of_nodes()} nodes / {G.number_of_edges()} links")
Gw = nx.Graph()
for n in nodes:
    if n["accessible"]: Gw.add_node(n["node_id"])
for e in edges:
    if e["accessible"] and not e["stairs_only"] and NID[e["from_node"]]["accessible"] and NID[e["to_node"]]["accessible"]: Gw.add_edge(e["from_node"], e["to_node"])
for c in conns:
    if c["accessible"]: Gw.add_edge(c["from_node"], c["to_node"])
comps = sorted(nx.connected_components(Gw), key=len, reverse=True)
info("JSON", "J-GRAPH-WC", "Wheelchair-accessible subgraph components", f"{len(comps)} comps; main={len(comps[0])} nodes; others={[sorted(c)[:2] for c in comps[1:]][:4]}")
ap = [a for a in nx.articulation_points(Gw)]; br = list(nx.bridges(Gw))
info("JSON", "J-SPOF", "Wheelchair graph single points of failure (articulation points / bridges)", f"{len(ap)} articulation nodes, {len(br)} bridge edges (many are expected leaf rooms/doors)")
# accessible elevator redundancy: with one elevator out can every floor still be reached?
# --- consistency of docs claims against files
claims = []
claims.append(("ENT/connector parity", {c["indoor_node_id"] for c in connectors} == {e["node_id"] for e in feats["entrances"]}))
claims.append(("fountains 2 per floor", all(sum(1 for x in feats["fountains"] if x["floor_id"] == f"BLD001_F{f}") == 2 for f in (1, 2, 3))))
claims.append(("narrow edges are hallway_2/8 families only", {EID[e["edge_id"]]["space_id"] for e in edges if e["potentially_narrow"]} <= {f"hallway_{b+i}" for b in (0, 8, 16) for i in (2, 8)}))
claims.append(("doors 1.2 m / lobby+elev lobby 3.0 m", {d["opening_width_synthetic_m"] for d in feats["doors"]} == {1.2, 3.0}))
claims.append(("connectors: all outdoor_node_id null", all(c["outdoor_node_id"] is None for c in connectors)))
claims.append(("accessible entrances 1-3, entrance_4 steps", [(e["feature_id"], e["accessible"]) for e in feats["entrances"]] == [("entrance_1", True), ("entrance_2", True), ("entrance_3", True), ("entrance_4", False)]))
for t, ok in claims: rec("Docs-vs-files", "C-" + re.sub(r"\W+", "-", t)[:30], f"Doc claim holds: {t}", ok)

json.dump([dict(section=a, id=b, description=c, status=d, detail=e) for a, b, c, d, e in R], open(f"{OUT}/phase2_static_results.json", "w"), indent=1)
c = collections.Counter(r[3] for r in R); print(dict(c))
for r in R:
    if r[3] in ("FAIL", "WARN"): print(r[3], r[1], r[2], "|", r[4])
for r in R:
    if r[3] == "INFO": print("INFO", r[1], r[2], "|", r[4])
