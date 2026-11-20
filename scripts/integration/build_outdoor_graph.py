#!/usr/bin/env python3
"""
Phase 4: outdoor routing graph from sidewalks.geojson. READ-ONLY on the source GeoJSON.
usage: build_outdoor_graph.py <uploads_dir> <integration_dir>
Writes outdoor_nodes.json, outdoor_edges.json, outdoor_graph_report.json (candidate gaps, components, crossings).
Nodes only where ways genuinely share a vertex, at way endpoints, and at provisional entrance attachment points.
Nothing is joined by proximity.
"""
import json, sys, math, hashlib, collections
from pyproj import Transformer, Geod
from shapely.geometry import shape, Point, LineString, Polygon
from shapely.strtree import STRtree
from shapely.ops import nearest_points

UP, OUT = sys.argv[1:3]
OFFSET_MAX_M = 5.0      # entrance original-point offset allowed before an outdoor entrance node is created
LINK_MAX_M = 10.0       # max length of the link from the wall point to a walkable footway
GAP_M = 3.0             # report (never join) endpoints closer than this to another way without a shared vertex
SPEED = {"footway": 1.3, "steps": 0.5}     # m/s, prototype assumption (same for walking and wheelchair; no wheelchair speed model)
R7 = lambda v: round(v, 7)
geod = Geod(ellps="WGS84")
S = json.load(open(f"{UP}/sidewalks.geojson"))["features"]; Bf = json.load(open(f"{UP}/buildings.geojson"))["features"]
REV = json.load(open(f"{OUT}/entrance_review.json"))
clon, clat = -84.5207, 33.9380
ENU = f"+proj=aeqd +lat_0={clat} +lon_0={clon} +datum=WGS84 +units=m"
to_m = Transformer.from_crs("EPSG:4326", ENU, always_xy=True); to_ll = Transformer.from_crs(ENU, "EPSG:4326", always_xy=True)

# ---- ways
ways = []
for f in S:
    p = f["properties"]
    if f["geometry"]["type"] != "LineString": continue
    ways.append(dict(id=p["id"], props=p, coords=[(R7(x), R7(y)) for x, y in f["geometry"]["coordinates"]]))
nwalk = collections.Counter(w["props"].get("highway") for w in ways)

# ---- entrance attachment points (provisional)
bld_m = [((f["properties"].get("name") or "unnamed") + " [" + str(f["properties"].get("id")) + "]", Polygon([to_m.transform(*c) for c in f["geometry"]["coordinates"][0]])) for f in Bf]
btree = STRtree([b for _, b in bld_m])
walk_lines = [(w["id"], LineString([to_m.transform(*c) for c in w["coords"]])) for w in ways if w["props"].get("highway") == "footway"]
attach = []; entr_report = []
for e in REV["entrances"]:
    fid = e["feature_id"]
    if e.get("original_coordinates") is None: continue          # synthetic indoor entrance_4: never an outdoor point
    rec = dict(feature_id=fid, review_status=e["review_status"], original_offset_m=e.get("distance_original_to_boundary_m"), outdoor_node=None, reason=None)
    entr_report.append(rec)
    if e["review_status"] == "needs_verification" or not e.get("proposed_snap"): rec["reason"] = "no proposed snap (needs_verification)"; continue
    if e["distance_original_to_boundary_m"] > OFFSET_MAX_M: rec["reason"] = f"original source point is {e['distance_original_to_boundary_m']} m from the footprint (> {OFFSET_MAX_M} m): too uncertain for an outdoor node"; continue
    sp = Point(*to_m.transform(e["proposed_snap"]["lon"], e["proposed_snap"]["lat"]))
    cands = sorted((l.distance(sp), wid, l) for wid, l in walk_lines)[:3]
    d, wid, line = cands[0]
    if d > LINK_MAX_M: rec["reason"] = f"nearest walkable footway is {d:.1f} m from the wall point (> {LINK_MAX_M} m)"; continue
    q = line.interpolate(line.project(sp)); link = LineString([(q.x, q.y), (sp.x, sp.y)])
    crossed = [n for i in btree.query(link) for n, b in [bld_m[i]] if link.intersection(b.buffer(-0.3)).length > 0.05]
    if crossed: rec["reason"] = f"link would cross building(s): {crossed}"; continue
    steps_near = [wid2 for wid2, h in [(w['id'], w['props'].get('highway')) for w in ways] if h == "steps"]
    amb = [(round(dd, 1), w2) for dd, w2, _ in cands[1:] if dd - d < 2.0]
    qlon, qlat = to_ll.transform(q.x, q.y)
    attach.append(dict(feature_id=fid, way=wid, point=(R7(qlon), R7(qlat)), snap=(e["proposed_snap"]["lon"], e["proposed_snap"]["lat"]), link_m=round(d, 2), e=e, ambiguous_alternatives=amb))
    rec.update(outdoor_node="pending", attached_way=wid, link_length_m=round(d, 2), ambiguous_alternatives=amb)

# ---- insert attachment vertices into their ways (no proximity joins elsewhere)
byid = {w["id"]: w for w in ways}
for a in attach:
    w = byid[a["way"]]; pt = Point(*a["point"]); best = None
    for i in range(len(w["coords"]) - 1):
        sg = LineString([w["coords"][i], w["coords"][i + 1]]); dd = sg.distance(pt)
        if best is None or dd < best[0]: best = (dd, i)
    key = (R7(a["point"][0]), R7(a["point"][1]))
    if key in w["coords"]: a["vertex"] = key; continue
    w["coords"].insert(best[1] + 1, key); a["vertex"] = key
# ---- node vertices: way endpoints, vertices used by >= 2 ways (or twice in one way), attachment vertices
cnt = collections.Counter(); 
for w in ways:
    for c in w["coords"]: cnt[c] += 1
nodevtx = {c for c, n in cnt.items() if n >= 2}
for w in ways: nodevtx.add(w["coords"][0]); nodevtx.add(w["coords"][-1])
for a in attach: nodevtx.add(a["vertex"])
nid = lambda c: "on_" + hashlib.sha1(f"{c[0]:.7f},{c[1]:.7f}".encode()).hexdigest()[:10]
ids = {c: nid(c) for c in nodevtx}; assert len(set(ids.values())) == len(ids), "node id collision"

edges = []
for w in ways:
    p = w["props"]; hw = p.get("highway"); num = w["id"].split("/")[-1]; seg = 0; cur = [w["coords"][0]]
    for c in w["coords"][1:]:
        cur.append(c)
        if c in nodevtx:
            if len(cur) >= 2 and cur[0] != cur[-1] or len(cur) > 2:
                lons, lats = zip(*cur); L = geod.line_length(lons, lats)
                steps = hw == "steps"
                edges.append(dict(edge_id=f"oe_{num}_{seg}", from_node=ids[cur[0]], to_node=ids[cur[-1]], osm_way=w["id"], edge_type="steps" if steps else ("crossing" if p.get("footway") == "crossing" else "footway"),
                    distance=round(L, 2), travel_time=round(L / SPEED[hw], 2), distance_unit="meters",
                    accessible=(not steps), stairs_only=steps, accessibility_basis=("highway=steps" if steps else "no exclusion tag; accessibility UNKNOWN (no wheelchair/incline-value data)"),
                    verified=False, synthetic=False, obstacle_status="none", bidirectional=True,
                    attributes={k: p[k] for k in ("highway", "footway", "surface", "incline", "ramp", "ramp:wheelchair", "step_count", "handrail", "crossing", "crossing:markings", "crossing:signals", "tactile_paving", "tunnel", "bridge", "layer", "covered", "lit", "access", "name") if p.get(k) not in (None, "")},
                    geometry=[list(x) for x in cur]))
            seg += 1; cur = [c]
# ---- entrance links + outdoor entrance nodes
nodes = {}
deg = collections.Counter()
for e in edges: deg[e["from_node"]] += 1; deg[e["to_node"]] += 1
for c, i in ids.items():
    nodes[i] = dict(node_id=i, lon=c[0], lat=c[1], node_type="junction" if deg[i] >= 3 else ("endpoint" if deg[i] == 1 else "waypoint"), degree=deg[i], source="sidewalks.geojson", derived=True)
for a in attach:
    e = a["e"]; fid = a["feature_id"]; oid = "oe_" + (e.get("proposed_row_correction", {}).get("feature_id") or fid); sid = ids[a["vertex"]]
    nodes[sid]["node_type"] = "entrance_attach" if nodes[sid]["node_type"] in ("endpoint", "waypoint") else nodes[sid]["node_type"]; nodes[sid].setdefault("attached_entrances", []).append(oid)
    nodes[oid] = dict(node_id=oid, lon=a["snap"][0], lat=a["snap"][1], node_type=("ramp_entrance" if e["feature_type"] == "ramp" else "entrance"), degree=1, source="entrances_ramps.geojson (PROPOSED snap, not verified)",
                      derived=True, source_feature_id=fid, review_status=e["review_status"], provisional=True, verified=False, requires_field_verification=True, accessible_source_flag=e["source_accessible_flag"],
                      identity_pending_review=bool(e.get("proposed_row_correction")), ambiguous_attachment=bool(a["ambiguous_alternatives"]), ambiguous_alternatives=a["ambiguous_alternatives"], building_id=e["building_id"], original_offset_m=e["distance_original_to_boundary_m"])
    from_ = sid; L = a["link_m"]
    edges.append(dict(edge_id=f"oel_{oid[3:]}", from_node=sid, to_node=oid, osm_way=a["way"], edge_type="entrance_link", distance=L, travel_time=round(L / SPEED["footway"], 2), distance_unit="meters",
        accessible=bool(e["source_accessible_flag"]), stairs_only=False, accessibility_basis="source accessible flag only (unverified); slope/surface of the link unknown", verified=False, synthetic=False, provisional=True,
        obstacle_status="none", bidirectional=True, attributes={"note": "straight link from the footway to the proposed wall point; checked against all building polygons, not a surveyed path"}, geometry=[[nodes[sid]["lon"], nodes[sid]["lat"]], [a["snap"][0], a["snap"][1]]]))
    for r in entr_report:
        if r["feature_id"] == fid: r["outdoor_node"] = oid; r["attachment_node"] = sid
for r in entr_report:
    if r["outdoor_node"] == "pending": r["outdoor_node"] = None

# ---- components
par = {}
def find(x):
    while par.setdefault(x, x) != x: par[x] = par[par[x]]; x = par[x]
    return x
for e in edges: par[find(e["from_node"])] = find(e["to_node"])
comp = collections.defaultdict(list)
for i in nodes: comp[find(i)].append(i)
order = sorted(comp.values(), key=len, reverse=True)
cid = {}
for k, members in enumerate(order, 1):
    for i in members: cid[i] = f"C{k:02d}"
for i, n in nodes.items(): n["component_id"] = cid[i]
for e in edges: e["component_id"] = cid[e["from_node"]]
ecount = collections.Counter(e["component_id"] for e in edges)
comps = []
for k, members in enumerate(order, 1):
    lons = [nodes[i]["lon"] for i in members]; lats = [nodes[i]["lat"] for i in members]
    L = sum(e["distance"] for e in edges if e["component_id"] == f"C{k:02d}" and e["edge_type"] != "entrance_link")
    comps.append(dict(component_id=f"C{k:02d}", nodes=len(members), edges=ecount[f"C{k:02d}"], length_m=round(L), bbox=[min(lons), min(lats), max(lons), max(lats)],
                      steps_edges=sum(1 for e in edges if e["component_id"] == f"C{k:02d}" and e["stairs_only"]), entrance_nodes=[i for i in members if nodes[i]["node_type"] in ("entrance", "ramp_entrance")]))
# which components are on the Marietta campus? distance of each component's closest node to the BLD001 footprint centre
bld1 = [b for n, b in bld_m if "way/225446888" in n][0].centroid
CAMPUS_R = 2000.0
for c in comps:
    ds = [Point(*to_m.transform(nodes[i]["lon"], nodes[i]["lat"])).distance(bld1) for i in order[int(c["component_id"][1:]) - 1]]
    c["min_distance_to_marietta_campus_centre_m"] = round(min(ds)); c["on_marietta_campus"] = min(ds) <= CAMPUS_R
for n in nodes.values(): n["on_marietta_campus"] = next(c["on_marietta_campus"] for c in comps if c["component_id"] == n["component_id"])
# wheelchair-only components (excluding steps)
wpar = {}
def wfind(x):
    while wpar.setdefault(x, x) != x: wpar[x] = wpar[wpar[x]]; x = wpar[x]
    return x
for e in edges:
    if e["accessible"] and not e["stairs_only"]: wpar[wfind(e["from_node"])] = wfind(e["to_node"])
wc = collections.Counter(wfind(i) for i in nodes)
wsizes = sorted(wc.values(), reverse=True)

# ---- candidate gaps (reported, NEVER joined) and crossings without shared vertex
lines_m = {w["id"]: LineString([to_m.transform(*c) for c in w["coords"]]) for w in ways}
wl = list(lines_m.items()); tree = STRtree([l for _, l in wl])
node_ways = collections.defaultdict(set)
for e in edges: node_ways[e["from_node"]].add(e["osm_way"]); node_ways[e["to_node"]].add(e["osm_way"])
gaps = []
for i, n in nodes.items():
    if n["degree"] != 1 or n["node_type"] in ("entrance", "ramp_entrance"): continue
    pt = Point(*to_m.transform(n["lon"], n["lat"]))
    for j in tree.query(pt.buffer(GAP_M)):
        wid, l = wl[j]
        if wid in node_ways[i]: continue
        d = l.distance(pt)
        if 0 < d <= GAP_M and cid[i] != None:
            other = next((cid[k] for k, nn in nodes.items() if wid in node_ways.get(k, ()) ), None)
            gaps.append(dict(endpoint_node=i, endpoint_component=cid[i], near_way=wid, distance_m=round(d, 2), near_way_component=other, would_join_components=(other != cid[i]), action="REPORTED ONLY - not joined; needs human review"))
gaps.sort(key=lambda g: g["distance_m"])
verts = collections.Counter(c for w in ways for c in w["coords"]); crossings = []
for a in range(len(wl)):
    for j in tree.query(wl[a][1]):
        if j <= a: continue
        inter = wl[a][1].intersection(wl[j][1])
        if inter.is_empty or inter.geom_type != "Point": continue
        q = to_ll.transform(inter.x, inter.y); key = (R7(q[0]), R7(q[1]))
        near_vertex = any(math.hypot(inter.x - px, inter.y - py) < 0.02 for px, py in list(wl[a][1].coords) + list(wl[j][1].coords))
        if not near_vertex:
            pa, pb = byid[wl[a][0]]["props"], byid[wl[j][0]]["props"]
            crossings.append(dict(way_a=wl[a][0], way_b=wl[j][0], layer_a=pa.get("layer"), layer_b=pb.get("layer"), bridge_a=pa.get("bridge"), bridge_b=pb.get("bridge"), tunnel_a=pa.get("tunnel"), tunnel_b=pb.get("tunnel"),
                                  highway_a=pa.get("highway"), highway_b=pb.get("highway"), explained_by_grade_separation=any([pa.get("bridge"), pb.get("bridge"), pa.get("tunnel"), pb.get("tunnel"), pa.get("layer") != pb.get("layer")]), action="NOT joined"))
# closest approach between components (information for review; nothing is joined)
comp_ways = collections.defaultdict(set)
for e in edges:
    if e["edge_type"] != "entrance_link": comp_ways[e["component_id"]].add(e["osm_way"])
from shapely.ops import unary_union, nearest_points as _np
cm = {c: unary_union([lines_m[w] for w in ws if w in lines_m]) for c, ws in comp_ways.items()}
top = [c["component_id"] for c in comps[:8]]; approach = []
for a_ in range(len(top)):
    for b_ in range(a_ + 1, len(top)):
        pa, pb = _np(cm[top[a_]], cm[top[b_]]); lla, llb = to_ll.transform(pa.x, pa.y), to_ll.transform(pb.x, pb.y)
        approach.append(dict(component_a=top[a_], component_b=top[b_], closest_distance_m=round(pa.distance(pb), 1), point_a=[R7(lla[0]), R7(lla[1])], point_b=[R7(llb[0]), R7(llb[1])], action="REPORTED ONLY - not joined"))
approach.sort(key=lambda r: r["closest_distance_m"])
# building crossings (data-quality info)
bcross = 0
for wid, l in wl:
    if any(l.intersection(bld_m[i][1].buffer(-0.5)).length > 1 for i in btree.query(l)): bcross += 1

meta = dict(schema_version="1.0.0", derived_from="sidewalks.geojson (read-only)", coordinate_reference="EPSG:4326 lon/lat", id_scheme="nodes: 'on_'+sha1(lon7,lat7)[:10] (stable for identical coordinates); edges: oe_<osm way number>_<segment index>; entrance nodes 'oe_<FEATURE_ID>'",
            speeds_m_per_s=SPEED, speed_note="prototype assumptions, not measurements; wheelchair uses the same speeds")
json.dump(dict(**meta, nodes=list(nodes.values())), open(f"{OUT}/outdoor_nodes.json", "w"), indent=1)
json.dump(dict(**meta, edges=edges), open(f"{OUT}/outdoor_edges.json", "w"), indent=1)
rep = dict(summary=dict(source_ways=len(ways), source_highway=dict(nwalk), nodes=len(nodes), edges=len(edges), entrance_nodes=sum(1 for n in nodes.values() if n["node_type"] in ("entrance", "ramp_entrance")),
    node_types=dict(collections.Counter(n["node_type"] for n in nodes.values())), edge_types=dict(collections.Counter(e["edge_type"] for e in edges)), components=len(comps), total_length_m=round(sum(e["distance"] for e in edges if e["edge_type"] != "entrance_link")),
    steps_edges=sum(e["stairs_only"] for e in edges), wheelchair_components_excluding_steps=len(wsizes), wheelchair_largest_component_nodes=wsizes[0], ways_crossing_building_interiors=bcross),
    campus_radius_m=CAMPUS_R, components=comps, entrance_attachment=entr_report, candidate_gaps=gaps, closest_approach_between_top_components=approach, crossings_without_shared_vertex=crossings,
    thresholds=dict(offset_max_m=OFFSET_MAX_M, link_max_m=LINK_MAX_M, gap_report_m=GAP_M))
json.dump(rep, open(f"{OUT}/outdoor_graph_report.json", "w"), indent=1)
json.dump(dict(**meta, nodes=list(nodes.values())), open(f"{OUT}/outdoor_nodes.json", "w"), indent=1)
mar = [c for c in comps if c["on_marietta_campus"]]; rep["marietta_summary"] = dict(components=len(mar), component_ids=[c["component_id"] for c in mar], nodes=sum(c["nodes"] for c in mar), length_m=sum(c["length_m"] for c in mar), largest=mar[0]["component_id"], largest_share_of_length=round(mar[0]["length_m"] / sum(c["length_m"] for c in mar), 3), entrance_nodes_by_component={c["component_id"]: c["entrance_nodes"] for c in mar if c["entrance_nodes"]}); json.dump(rep, open(f"{OUT}/outdoor_graph_report.json", "w"), indent=1)
print("MARIETTA:", json.dumps(rep["marietta_summary"])); print([(c["component_id"], c["nodes"], c["length_m"], c["min_distance_to_marietta_campus_centre_m"]) for c in comps[:12]])
print(json.dumps(rep["summary"], indent=1)); print("components (nodes/edges/length_m/entrances):", [(c["component_id"], c["nodes"], c["edges"], c["length_m"], len(c["entrance_nodes"])) for c in comps[:8]], "...", len(comps))
print("closest approaches (top comps):", [(a["component_a"], a["component_b"], a["closest_distance_m"]) for a in approach[:8]])
print("gaps:", len(gaps), "joining-components gaps:", sum(g["would_join_components"] for g in gaps), "| crossings:", len(crossings))
for r in entr_report: print(r["feature_id"], r["outdoor_node"], r.get("attached_way"), r.get("link_length_m"), "|", r["reason"] or "", r.get("ambiguous_alternatives") or "")
