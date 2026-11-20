#!/usr/bin/env python3
"""Validates the SYNTHETIC BLD001 indoor data and runs routing tests. Writes documentation/validation_report.md"""
import json, math, os, re, sys, itertools, collections
import xml.etree.ElementTree as ET
import jsonschema, networkx as nx
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
sys.path.insert(0, os.path.dirname(__file__))
from indoor_routing import IndoorGraph

OUT = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/outputs/indoor-mapping"
BD = os.path.join(OUT, "buildings", "BLD001")
OX, OY, H, SC = 150.0, 110.0, 90.0, 10.0
ld = lambda n: json.load(open(os.path.join(BD, n)))
rooms = ld("rooms.json")["rooms"]; nodes = ld("nodes.json")["nodes"]; edges = ld("edges.json")["edges"]
conns = ld("connections.json")["connections"]; obs = ld("obstacles.json"); feats = ld("features.json")["features"]
connectors = ld("connectors.json")["connectors"]; meta = ld("metadata.json")
bjson = json.load(open(os.path.join(OUT, "shared", "buildings.json")))
schema = json.load(open(os.path.join(OUT, "shared", "indoor_schema.json")))
NID = {n["node_id"]: n for n in nodes}
def m(x, y): return ((x - OX) / SC, H - (y - OY) / SC)          # svg -> local meters
def mp(poly): return Polygon([m(*p) for p in poly])

results = []     # (section, id, description, passed, detail)
def chk(sec, cid, desc, ok, detail=""): results.append((sec, cid, desc, bool(ok), detail))

# ------------------------------------------------------------------ parse SVGs
SVG = {}
ns = {"s": "http://www.w3.org/2000/svg"}
for f in (1, 2, 3):
    root = ET.parse(os.path.join(BD, f"floor_{f}.svg")).getroot()
    ids = [e.get("id") for e in root.iter() if e.get("id")]
    SVG[f] = dict(root=root, ids=ids, byid={e.get("id"): e for e in root.iter() if e.get("id")})
def parse_path(d):
    return [tuple(map(float, p.split())) for p in re.findall(r"[ML]\s*([\-\d.]+ [\-\d.]+)", d)]

# ================================================================== DATA VALIDATION
sec = "Data"
for name, items, key in (("rooms", rooms, "room_id"), ("nodes", nodes, "node_id"), ("edges", edges, "edge_id"),
                         ("connections", conns, "connection_id"), ("obstacles", obs["obstacles"], "obstacle_id"),
                         ("doors", feats["doors"], "door_id"), ("connectors", connectors, "connector_id")):
    ids = [i[key] for i in items]
    chk(sec, f"D-ID-{name}", f"All {name} IDs unique (building scope)", len(ids) == len(set(ids)), f"{len(ids)} ids")
chk(sec, "D-ID-svg", "SVG element ids unique within each floor file", all(len(v["ids"]) == len(set(v["ids"])) for v in SVG.values()),
    "dups: " + str({f: [i for i, c in collections.Counter(v['ids']).items() if c > 1] for f, v in SVG.items()}))
# schema
files = {"rooms.json": ld("rooms.json"), "nodes.json": ld("nodes.json"), "edges.json": ld("edges.json"), "connections.json": ld("connections.json"),
         "obstacles.json": ld("obstacles.json"), "connectors.json": ld("connectors.json"), "buildings.json": bjson}
for fn, doc in files.items():
    errs = list(jsonschema.Draft7Validator(schema["files"][fn], resolver=jsonschema.RefResolver.from_schema(schema)).iter_errors(doc))
    chk(sec, f"D-SCHEMA-{fn}", f"{fn} validates against indoor_schema.json", not errs, "; ".join(e.message[:80] for e in errs[:2]))
# coordinates
Fpoly = Polygon([m(*p) for p in bjson["buildings"][0]["exterior_footprint"]["coordinates"][0]])
bad = []
for n in nodes:
    p = Point(m(n["x"], n["y"]))
    if not (0 <= n["x"] <= 680 and 0 <= n["y"] <= 1120) or Fpoly.buffer(0.05).distance(p) > 0.0: bad.append(n["node_id"])
chk(sec, "D-NODE-COORD", "Every node has coordinates inside the viewBox and inside/on the building footprint", not bad, f"bad: {bad[:5]}")
nid_floor = {n["node_id"]: n["floor_id"] for n in nodes}
miss = [e["edge_id"] for e in edges if e["from_node"] not in NID or e["to_node"] not in NID]
chk(sec, "D-EDGE-REF", "Every edge references existing nodes", not miss, str(miss[:5]))
edges = [e for e in edges if e["edge_id"] not in set(miss)]   # keep going; later checks only use well-formed edges
cross = [e["edge_id"] for e in edges if nid_floor[e["from_node"]] != nid_floor[e["to_node"]] or nid_floor[e["from_node"]] != e["floor_id"]]
chk(sec, "D-EDGE-FLOOR", "Edges never cross floors (floors are linked only via connections.json)", not cross, str(cross[:5]))
dd = [e["edge_id"] for e in edges if abs(math.hypot(NID[e["from_node"]]["x"] - NID[e["to_node"]]["x"], NID[e["from_node"]]["y"] - NID[e["to_node"]]["y"]) / SC - e["distance"]) > 0.011]
chk(sec, "D-EDGE-DIST", "Every edge distance equals Euclidean node distance (meters, 10 units = 1 m)", not dd, str(dd[:5]))
vc = []
for c in conns:
    a, b = NID.get(c["from_node"]), NID.get(c["to_node"])
    want = {"elevator": "elevator", "staircase": "staircase"}[c["connection_type"]]
    ok = a and b and a["floor_id"] == c["from_floor"] and b["floor_id"] == c["to_floor"] and a["node_type"] == want == b["node_type"] \
         and (a["x"], a["y"]) == (b["x"], b["y"]) and a["floor_id"] != b["floor_id"]
    if not ok: vc.append(c["connection_id"])
chk(sec, "D-CONN", "Every vertical connection joins same-type, same-x/y nodes on the declared adjacent floors", not vc, str(vc))
chk(sec, "D-CONN-ACC", "Elevator connections accessible=true; staircase connections accessible=false & stairs_only=true",
    all((c["accessible"] and not c["stairs_only"]) if c["connection_type"] == "elevator" else (not c["accessible"] and c["stairs_only"]) for c in conns))
# rooms -> graph
G = nx.Graph()
for e in edges: G.add_edge(e["from_node"], e["to_node"], w=e["travel_time"], e=e)
for c in conns: G.add_edge(c["from_node"], c["to_node"], w=c["travel_time"])
noent, nohall = [], []
for r in rooms:
    if r["category"] != "room": continue
    if not r["navigable"]:
        has = [n for n in nodes if n["room_id"] == r["room_id"]]
        chk(sec, f"D-SERVICE-{r['room_id']}", f"{r['room_id']} is a documented non-navigable service space with no graph nodes", not has)
        continue
    re_n = NID.get(r["entrance_node_id"]); dn = NID.get(r["destination_node_id"])
    if not (re_n and re_n["node_type"] == "room_entrance" and dn): noent.append(r["room_id"]); continue
    nbrs = [NID[x] for x in G.neighbors(r["entrance_node_id"])]
    if not any(n["node_type"] in ("hallway_waypoint", "hallway_intersection") for n in nbrs): nohall.append(r["room_id"])
chk(sec, "D-ROOM-ENTR", "Every navigable room has a room_entrance node and a destination/stair node", not noent, str(noent))
chk(sec, "D-ROOM-HALL", "Every room_entrance node connects to a hallway/circulation node", not nohall, str(nohall))
chk(sec, "D-CONNECTED", "Whole indoor graph (incl. vertical links) is one connected component", nx.is_connected(G), f"{nx.number_connected_components(G)} component(s), {G.number_of_nodes()} nodes")
iso = [n for n in NID if G.degree(n) == 0]
chk(sec, "D-ISOLATED", "No isolated nodes", not iso, str(iso))
# obstacles reference
ref_bad = []
for o in obs["obstacles"]:
    for k in ("location_node_id", "affected_edge_id"):
        if k in o and o[k] not in (NID if k == "location_node_id" else {e["edge_id"] for e in edges}): ref_bad.append(o["obstacle_id"])
    for n in o.get("affected_node_ids", []):
        if n not in NID: ref_bad.append(o["obstacle_id"])
chk(sec, "D-OBS-REF", "Obstacles reference existing nodes/edges", not ref_bad, str(ref_bad))
chk(sec, "D-OBS-STATUS", "Obstacle statuses cover pending, verified and resolved",
    {o["status"] for o in obs["obstacles"]} == {"pending", "verified", "resolved"})
chk(sec, "D-CONNECTOR", "All outdoor connectors reference existing entrance nodes and leave outdoor_node_id null",
    all(c["indoor_node_id"] in NID and NID[c["indoor_node_id"]]["node_type"] == "entrance" and c["outdoor_node_id"] is None for c in connectors))
chk(sec, "D-SYNTH", "Every record in every file is flagged synthetic=true",
    all(i.get("synthetic") is True for it in (rooms, nodes, edges, conns, obs["obstacles"], connectors) for i in it))

# ---- SVG/JSON agreement
disagree = []
for f in (1, 2, 3):
    fl = f"BLD001_F{f}"; by = SVG[f]["byid"]
    for r in [r for r in rooms if r["floor_id"] == fl]:
        el = by.get(r["room_id"])
        if el is None: disagree.append(f"{r['room_id']} missing in svg"); continue
        pts = parse_path(el.get("d")); xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        if (abs(min(xs) - r["x"]) > .11 or abs(min(ys) - r["y"]) > .11 or abs((max(xs) - min(xs)) - r["width"]) > .11 or abs((max(ys) - min(ys)) - r["height"]) > .11):
            disagree.append(f"{r['room_id']} bbox")
    for n in [n for n in nodes if n["floor_id"] == fl]:
        el = by.get("svgnode_" + n["node_id"])
        if el is None or abs(float(el.get("cx")) - n["x"]) > .01 or abs(float(el.get("cy")) - n["y"]) > .01: disagree.append(n["node_id"])
    for d in [d for d in feats["doors"] if d["floor_id"] == fl]:
        if d["door_id"] not in by: disagree.append(d["door_id"])
    for e_ in [x for x in feats["entrances"] if x["floor_id"] == fl]:
        if e_["feature_id"] not in by: disagree.append(e_["feature_id"])
    for need in ("elevator_1", "elevator_2", "stairwell_1", "stairwell_2", "route_layer", "layer_walls_exterior", "layer_rooms", "layer_doors",
                 "layer_labels", "layer_stairs", "layer_elevators", "layer_accessibility", "layer_obstacles"):
        if need not in by: disagree.append(f"F{f}:{need}")
    for o in [o for o in obs["obstacles"] if o["floor_id"] == fl]:
        if "obstacle_" + o["obstacle_id"] not in by: disagree.append(o["obstacle_id"])
chk(sec, "D-SVG-JSON", "SVG element ids, room bboxes, node coordinates, doors, entrances, obstacles agree with JSON on all floors", not disagree, str(disagree[:8]))
vb = {f: SVG[f]["root"].get("viewBox") for f in SVG}
chk(sec, "D-VIEWBOX", "All floors share one viewBox", len(set(vb.values())) == 1, str(set(vb.values())))

# ================================================================== VISUAL / GEOMETRY VALIDATION
sec = "Geometry"
fp = [SVG[f]["byid"]["footprint"].get("d") for f in SVG]
chk(sec, "G-FOOTPRINT", "Identical exterior footprint path on all floors", len(set(fp)) == 1)
chk(sec, "G-FOOTPRINT-JSON", "SVG footprint equals buildings.json exterior_footprint",
    [list(p) for p in parse_path(fp[0])] == [list(p) for p in bjson["buildings"][0]["exterior_footprint"]["coordinates"][0][:-1]])
chk(sec, "G-FOOTPRINT-VERT", "Footprint keeps all 25 source-polygon vertices (no simplification)", len(parse_path(fp[0])) == 25)
outside, overl = [], []
for f in (1, 2, 3):
    fl = f"BLD001_F{f}"
    polys = {r["room_id"]: mp(r["polygon"]) for r in rooms if r["floor_id"] == fl}
    for k, p in polys.items():
        if not Fpoly.buffer(0.02).contains(p): outside.append(k)
    items = list(polys.items())
    for (ka, pa), (kb, pb) in itertools.combinations(items, 2):
        a = pa.intersection(pb).area
        if a > 0.05 and not (ka.startswith("hallway") and kb.startswith("hallway")): overl.append((ka, kb, round(a, 2)))
chk(sec, "G-INSIDE", "All rooms/hallways lie inside the exterior footprint", not outside, str(outside))
chk(sec, "G-OVERLAP", "No overlapping rooms, or room/hallway overlaps (hallway-hallway junction overlap allowed)", not overl, str(overl[:5]))
dbad = []
for d in feats["doors"]:
    p = Point(m(d["x"], d["y"])); fl = d["floor_id"]
    if d["door_id"].startswith("door_elev"): continue
    owner = [r for r in rooms if r["room_id"] == d["room_id"]][0]
    if mp(owner["polygon"]).boundary.distance(p) > 0.3: dbad.append(d["door_id"])
chk(sec, "G-DOORS", "Every room door sits on its room's wall (<=0.3 m)", not dbad, str(dbad))
mis = []
for k in ("elevator_1", "elevator_2", "stairwell_1", "stairwell_2"):
    nm = "elev" if "elev" in k else "stair"; i = k[-1]
    pos = {(NID[f"n_f{f}_{nm}_{i}"]["x"], NID[f"n_f{f}_{nm}_{i}"]["y"]) for f in (1, 2, 3)}
    if len(pos) != 1: mis.append(k)
chk(sec, "G-ALIGN", "Elevator and stair nodes have identical x/y on floors 1-3", not mis, str(mis))
rects = {f: {k: (SVG[f]["byid"][k].find("s:rect", ns).attrib if k.startswith("elevator") else None) for k in ("elevator_1", "elevator_2")} for f in (1, 2, 3)}
chk(sec, "G-ALIGN-SHAFT", "Elevator shaft rectangles identical on all floors", all(rects[1] == rects[f] for f in (2, 3)))
stair_rect = {f: sorted(r["polygon"] and tuple(map(tuple, r["polygon"])) for r in rooms if r["floor_id"] == f"BLD001_F{f}" and r["room_number"] and r["room_number"][1:] in ("09", "16")) for f in (1, 2, 3)}
chk(sec, "G-ALIGN-STAIR", "Stairwell room geometry identical on all floors", stair_rect[1] == stair_rect[2] == stair_rect[3])
# edges vs walls
doors_m = {f: [(Point(m(d["x"], d["y"]))) for d in feats["doors"] if d["floor_id"] == f"BLD001_F{f}"] for f in (1, 2, 3)}
wallbad = []
for f in (1, 2, 3):
    fl = f"BLD001_F{f}"
    groups = {}
    circ = unary_union([mp(r["polygon"]) for r in rooms if r["floor_id"] == fl and r["category"] == "circulation"])
    groups["CIRC"] = circ
    for r in rooms:
        if r["floor_id"] == fl and r["category"] != "circulation": groups[r["room_id"]] = mp(r["polygon"])
    ash = {}
    for k in (1, 2):
        rr = SVG[f]["byid"][f"elevator_{k}"].find("s:rect", ns).attrib
        x, y, w, h = float(rr["x"]), float(rr["y"]), float(rr["width"]), float(rr["height"])
        groups[f"room_{f}05"] = groups[f"room_{f}05"].union(mp([(x, y), (x + w, y), (x + w, y + h), (x, y + h)]))
    allu = unary_union(list(groups.values())).buffer(0.3)
    for e in [e for e in edges if e["floor_id"] == fl]:
        a, b = NID[e["from_node"]], NID[e["to_node"]]
        ln = LineString([m(a["x"], a["y"]), m(b["x"], b["y"])])
        n = max(2, int(ln.length / 0.2))
        seq, ok = [], True
        for i in range(n + 1):
            pt = ln.interpolate(i / n, normalized=True)
            if not allu.contains(pt): ok = False; break
            g = next((k for k, gp in groups.items() if gp.buffer(0.03).contains(pt)), None)
            if g and (not seq or seq[-1][0] != g): seq.append((g, pt))
        if not ok: wallbad.append((e["edge_id"], "leaves building spaces")); continue
        for (ga, pa), (gb, pb) in zip(seq, seq[1:]):
            if not any(d.distance(pa) <= 0.7 or d.distance(pb) <= 0.7 for d in doors_m[f]):
                wallbad.append((e["edge_id"], f"{ga}->{gb} crosses wall away from a door"))
chk(sec, "G-EDGE-WALL", "No edge passes through a wall (space transitions occur only at doors/openings, all samples inside spaces)", not wallbad, str(wallbad[:6]))

# ================================================================== ROUTING
sec = "Routing"
g = IndoorGraph(BD)
def T(cid, desc, cond, detail=""): chk(sec, cid, desc, cond, detail)
def fmt(r): return (f"{r['travel_time_s']}s/{r['distance_m']}m, stairs={r['uses_stairs']}, elev={r['uses_elevator']}" if r["found"] else r["reason"])

r = g.route("entrance_1", "room_102"); T("R-01", "Main entrance (entrance_1) -> classroom room_102 (walking)", r["found"], fmt(r))
r = g.route("entrance_1", "room_102", wheelchair=True); T("R-02", "Same, wheelchair mode", r["found"] and not r["uses_stairs"], fmt(r))
base = g.route("room_102", "room_117"); T("R-03", "Classroom -> classroom: room_102 -> room_117", base["found"], fmt(base))
blocked_edge = [o for o in obs["obstacles"] if o["obstacle_id"] == "OBS-001"][0]["affected_edge_id"]
used_baseline = blocked_edge in [l.split(":")[1] for l in base["links"]]
T("R-04", "Baseline route room_102 -> room_117 uses the corridor segment later blocked by OBS-001", used_baseline, blocked_edge)
for wc in (False, True):
    rr = g.route("room_102", "room_117", wheelchair=wc, scenario="SCN-BLOCKED-HALLWAY")
    ok = rr["found"] and blocked_edge not in [l.split(":")[1] for l in rr["links"]] and rr["travel_time_s"] > g.route("room_102", "room_117", wheelchair=wc)["travel_time_s"]
    T(f"R-05{'b' if wc else 'a'}", f"Verified blocked hallway forces a longer alternative route ({'wheelchair' if wc else 'walking'})", ok, fmt(rr) + f" vs {fmt(g.route('room_102','room_117',wheelchair=wc))}")
rr = g.route("room_102", "room_117", scenario="SCN-UNVERIFIED-ONLY"); T("R-06", "Pending/unverified obstacle (OBS-004) does NOT change the route", rr["links"] == base["links"] and rr["applied_obstacles"] == [], fmt(rr))
rr = g.route("room_102", "room_103", scenario="SCN-UNVERIFIED-ONLY"); T("R-06b", "Room behind unverified blocked doorway remains reachable", rr["found"], fmt(rr))
b2 = g.route("room_201", "room_217"); r2 = g.route("room_201", "room_217", scenario="SCN-RESOLVED-IGNORED")
T("R-07", "Resolved obstacle (OBS-006) is ignored", r2["links"] == b2["links"] and r2["applied_obstacles"] == [], fmt(r2))
w = g.route("room_101", "room_212", wheelchair=True); s_ = g.route("room_101", "room_212")
T("R-08", "Floor-to-floor via elevator: room_101 -> room_212 (wheelchair)", w["found"] and w["uses_elevator"] and not w["uses_stairs"] and len(w["floors"]) == 2, fmt(w))
T("R-09", "Wheelchair mode excludes stairs while walking mode may use them", s_["found"] and s_["uses_stairs"] and not w["uses_stairs"], f"walking: {fmt(s_)} | wheelchair: {fmt(w)}")
r = g.route("room_101", "room_212", wheelchair=True, scenario="SCN-ELEVATOR-1-OUT")
T("R-10", "One elevator out of service (verified): wheelchair route still found via elevator 2", r["found"] and not any("elev_1" in n for n in r["nodes"]) and any("elev_2" in n for n in r["nodes"]), fmt(r))
r = g.route("entrance_1", "room_212", wheelchair=True, scenario="SCN-NO-ELEVATOR")
T("R-11", "Both elevators out: clear NO_ACCESSIBLE_ROUTE result for wheelchair to floor 2", (not r["found"]) and r["reason"] == "NO_ACCESSIBLE_ROUTE", fmt(r))
r = g.route("entrance_1", "room_212", scenario="SCN-NO-ELEVATOR"); T("R-12", "Same scenario, walking mode still reaches floor 2 via stairs", r["found"] and r["uses_stairs"], fmt(r))
r = g.route("entrance_4", "room_102", wheelchair=True); T("R-13", "Standard entrance with steps (entrance_4): NO_ACCESSIBLE_ROUTE for wheelchair", (not r["found"]) and r["reason"] == "NO_ACCESSIBLE_ROUTE", fmt(r))
r = g.route("entrance_4", "room_102"); T("R-14", "Standard entrance (entrance_4) usable in walking mode", r["found"], fmt(r))
r = g.route("entrance_3", "room_115", wheelchair=True)
T("R-15", "Ramp-served entrance_3 -> room_115 wheelchair route uses ramp edge", r["found"] and any(g.edges[l.split(':')[1]]["edge_type"] == "ramp" for l in r["links"] if l.startswith("edge")), fmt(r))
r = g.route("entrance_2", "room_314", wheelchair=True); T("R-16", "Entrance -> third-floor room via elevators (wheelchair, 2 vertical hops)", r["found"] and r["uses_elevator"] and len(r["floors"]) == 3, fmt(r))
for wc in (False, True):
    r = g.route("room_102", "room_119", wheelchair=wc, scenario="SCN-CONSTRUCTION")
    T(f"R-17{'b' if wc else 'a'}", f"Verified construction isolating room_119 -> {'NO_ACCESSIBLE_ROUTE' if wc else 'NO_ROUTE'}", (not r["found"]) and r["reason"] == ("NO_ACCESSIBLE_ROUTE" if wc else "NO_ROUTE"), fmt(r))
# cross-check Dijkstra with networkx on random pairs (no obstacles, walking and wheelchair)
import random; random.seed(7)
navrooms = [r_["room_id"] for r_ in rooms if r_["navigable"] and r_["category"] == "room"]
badx = []
Gw = nx.Graph(); Gk = nx.Graph()
for e in edges:
    Gk.add_edge(e["from_node"], e["to_node"], w=e["travel_time"])
    if e["accessible"] and not e["stairs_only"]: Gw.add_edge(e["from_node"], e["to_node"], w=e["travel_time"])
for c in conns:
    Gk.add_edge(c["from_node"], c["to_node"], w=c["travel_time"])
    if c["accessible"]: Gw.add_edge(c["from_node"], c["to_node"], w=c["travel_time"])
for _ in range(150):
    a, b = random.sample(navrooms, 2)
    for wc, GG in ((False, Gk), (True, Gw)):
        rr = g.route(a, b, wheelchair=wc)
        na, nb = g.resolve(a), g.resolve(b)
        try: ref = nx.dijkstra_path_length(GG, na, nb, weight="w")
        except (nx.NetworkXNoPath, nx.NodeNotFound): ref = None
        if (ref is None) != (not rr["found"]) or (ref is not None and abs(ref - rr["total_cost"]) > 0.02): badx.append((a, b, wc, ref, rr.get("total_cost")))
chk(sec, "R-18", "Dijkstra cross-check vs networkx on 150 random room pairs x 2 modes", not badx, str(badx[:3]))
# reachability from entrances
for wc in (False, True):
    unreach = [rid for rid in navrooms if not g.route("entrance_1", rid, wheelchair=wc)["found"]]
    exp = [r_["room_id"] for r_ in rooms if r_.get("navigable") and r_["room_type"] == "stairwell"] if wc else []
    chk(sec, f"R-19{'b' if wc else 'a'}", f"Every navigable room reachable from entrance_1 ({'wheelchair; stairwells expected unreachable' if wc else 'walking'})",
        sorted(unreach) == sorted(exp), f"unreachable: {unreach}")

# ================================================================== REPORT

APPENDIX = """
## Fault-injection test (proves the checks can fail)
On a scratch copy I injected: an edge joining `room_102` and `room_103` destination nodes through the shared wall, a wrong edge distance, an edge
referencing a missing node, and a vertical connection pointing at the wrong elevator. The validator reported **D-EDGE-REF, D-EDGE-DIST, D-CONN and
G-EDGE-WALL as FAIL** (plus one knock-on routing failure, R-16), and 59/64 passed. The real dataset passes all checks.

## TypeScript parity test
`tools/ts/indoorRouting.ts` compiled with `tsc --strict` (no errors) and was run under Node on 17 routing cases (walking, wheelchair, every scenario,
no-route cases). Results (time, distance, stairs/elevator use, node count, or failure reason) are **identical** to the Python router (0 mismatches).
Reproduce: compile the .ts to ES modules, then run `tools/ts/parity_check.mjs`.

## Issues found during generation and what was changed (nothing fixed silently)
1. **Legend overlapped the east entrance labels** on the first render of floor 1 -> legend moved right (x 505 -> 560).
2. **Elevator-lobby label overlapped the shaft symbols** -> label narrowed/moved (`label_w`, `label_pt`).
3. **Stair tread lines overshot the slanted south wall** of stairwell 1 -> treads clamped to y >= 5.6 m.
4. **Equal-length alternatives:** with a pure grid, the normal and the detour routes for the blocked-hallway demo tie in *distance* (62.0 m both). To make the
   demo deterministic the east link corridor was modeled as a synthetic 2.0 m "potentially narrow" hallway with 15% slower travel, so travel_time prefers the
   main corridor (52.2 s vs 54.0 s). Routing by distance would produce a tie.
5. **Validator robustness:** the first validator crashed on a dangling node reference instead of reporting it; it now reports and continues. The router
   ignores dangling references (the validator flags them).
6. **Tooling bug:** a shell brace-expansion mistake created a stray folder while setting up the output tree; it was deleted. No data impact.

## Known limitations / not validated
- **Footprint** is the OSM-derived polygon from `buildings.geojson`, cross-checked only by eye against the PDF maps (no pixel tracing of the PDFs). It is approximate.
- **Entrance positions** derive from three unverified reference points that lie 2.4-9.3 m from the footprint and were snapped to walls. `entrance_4` is invented.
- **Visual plausibility** was reviewed by inspecting PNG renders of all three floors (cairosvg). The SVGs were not tested in a browser or inside React.
  The SVG uses `href` on `<use>` (SVG 2); very old Safari needs `xlink:href`.
- Minor cosmetic issue: stair-tread lines run behind the "Stairwell" label.
- Rooms are plausible academic layouts, not architecture: no structural grid, egress, code compliance or accessibility dimensions were checked.
- The React integration snippet in `integration_guide.md` was not executed.
"""

passed = sum(1 for r in results if r[3]); total = len(results)
L = ["# Validation Report - BLD001 (H, Academic Building)", "", "> **SYNTHETIC / MOCK DATA.** Generated by `tools/validate_and_route.py`; do not edit by hand.", "",
     f"**Result: {passed}/{total} automated checks passed.**" + ("" if passed == total else f" **{total-passed} FAILED - see below.**"), ""]
for s_ in ("Data", "Geometry", "Routing"):
    L += [f"## {s_} checks", "", "| ID | Check | Result | Detail |", "|---|---|---|---|"]
    for sec_, cid, desc, ok, det in results:
        if sec_ == s_: L.append(f"| {cid} | {desc} | {'PASS' if ok else '**FAIL**'} | {det.replace('|', '/')[:160]} |")
    L.append("")
L.append(APPENDIX)
open(os.path.join(OUT, "documentation", "validation_report.md"), "w").write("\n".join(L))
print(f"{passed}/{total} passed")
for r in results:
    if not r[3]: print("FAIL", r[1], r[2], r[4])
