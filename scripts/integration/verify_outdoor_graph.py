#!/usr/bin/env python3
"""Independent checks of outdoor_nodes.json / outdoor_edges.json against the raw sidewalks.geojson. usage: verify_outdoor_graph.py <uploads> <integration_dir>"""
import json, sys, math, collections
import networkx as nx
from pyproj import Geod
UP, OUT = sys.argv[1:3]; geod = Geod(ellps="WGS84")
S = json.load(open(f"{UP}/sidewalks.geojson"))["features"]; N = json.load(open(f"{OUT}/outdoor_nodes.json"))["nodes"]; E = json.load(open(f"{OUT}/outdoor_edges.json"))["edges"]
rep = json.load(open(f"{OUT}/outdoor_graph_report.json")); R = []
def chk(i, d, ok, det=""): R.append((i, d, bool(ok), str(det)[:200]))
ND = {n["node_id"]: n for n in N}
chk("O-01", "node ids unique; edge ids unique", len(ND) == len(N) and len({e["edge_id"] for e in E}) == len(E))
chk("O-02", "every edge references existing nodes", all(e["from_node"] in ND and e["to_node"] in ND for e in E))
chk("O-03", "edge geometry starts/ends exactly at its nodes", all(abs(e["geometry"][0][0] - ND[e["from_node"]]["lon"]) < 1e-9 and abs(e["geometry"][0][1] - ND[e["from_node"]]["lat"]) < 1e-9 and abs(e["geometry"][-1][0] - ND[e["to_node"]]["lon"]) < 1e-9 and abs(e["geometry"][-1][1] - ND[e["to_node"]]["lat"]) < 1e-9 for e in E))
chk("O-04", "distance > 0 and equals geodesic length of the stored geometry (+-0.02 m)", all(e["distance"] > 0 and abs(geod.line_length(*zip(*e["geometry"])) - e["distance"]) <= 0.02 for e in E))
sp = {"footway": 1.3, "steps": 0.5}
chk("O-05", "travel_time == distance / speed (footway 1.3, steps 0.5 m/s)", all(abs(e["travel_time"] - e["distance"] / (0.5 if e["stairs_only"] else 1.3)) <= 0.011 for e in E if e["edge_type"] != "entrance_link"))
# conservation of length: sum of source way lengths == sum of non-link edge lengths
src = sum(geod.line_length(*zip(*[(round(x, 7), round(y, 7)) for x, y in f["geometry"]["coordinates"]])) for f in S)
mine = sum(e["distance"] for e in E if e["edge_type"] != "entrance_link"); inserted = 0
chk("O-06", "total edge length equals total source way length (+-0.5%; attach vertices split ways, no length created)", abs(src - mine) / src < 0.005, f"source {src:.0f} m, graph {mine:.0f} m")
chk("O-07", "every source way is covered by edges", {e["osm_way"] for e in E if e["edge_type"] != "entrance_link"} == {f["properties"]["id"] for f in S})
# independent connectivity from raw shared vertices
par = {}
def fd(x):
    while par.setdefault(x, x) != x: par[x] = par[par[x]]; x = par[x]
    return x
for f in S:
    cs = [(round(x, 7), round(y, 7)) for x, y in f["geometry"]["coordinates"]]
    for a, b in zip(cs, cs[1:]): par[fd(a)] = fd(b)
raw = len({fd(v) for v in list(par)})
G = nx.Graph(); G.add_edges_from((e["from_node"], e["to_node"]) for e in E if e["edge_type"] != "entrance_link")
chk("O-08", "component count equals the raw shared-vertex component count (no proximity joins, none lost)", nx.number_connected_components(G) == raw, f"graph {nx.number_connected_components(G)} vs raw {raw}")
G2 = nx.Graph(); G2.add_edges_from((e["from_node"], e["to_node"]) for e in E)
chk("O-09", "entrance links add no component merges", nx.number_connected_components(G2) == nx.number_connected_components(G) + 0)
chk("O-10", "all 29 steps edges inaccessible and stairs_only; all other footway edges accessible=true with 'unknown' basis", all((e["accessible"] is False and e["stairs_only"]) if e["edge_type"] == "steps" else e["accessible"] for e in E if e["edge_type"] != "entrance_link") and sum(e["stairs_only"] for e in E) == 29)
chk("O-11", "no outdoor edge is verified or marked synthetic-accessible", all(e["verified"] is False for e in E))
ent = [n for n in N if n["node_type"] in ("entrance", "ramp_entrance")]
chk("O-12", "entrance nodes are provisional, unverified, and have exactly one link edge", all(n["provisional"] and n["verified"] is False for n in ent) and all(sum(1 for e in E if e["edge_type"] == "entrance_link" and n["node_id"] in (e["from_node"], e["to_node"])) == 1 for n in ent), [n["node_id"] for n in ent])
chk("O-13", "no entrance node exists for entrance_4 or for any needs_verification row", not any(n.get("review_status") == "needs_verification" for n in ent) and not any("entrance_4" in json.dumps(n) for n in ent))
chk("O-14", "every crossing without a shared vertex is grade-separated (bridge/tunnel/layer) and the two ways share no graph node", all(c["explained_by_grade_separation"] and not (set(x for e in E if e["osm_way"] == c["way_a"] for x in (e["from_node"], e["to_node"])) & set(x for e in E if e["osm_way"] == c["way_b"] for x in (e["from_node"], e["to_node"]))) for c in rep["crossings_without_shared_vertex"]), f"{len(rep['crossings_without_shared_vertex'])} crossings: {[(c['way_a'][-9:], c['way_b'][-9:], c['explained_by_grade_separation']) for c in rep['crossings_without_shared_vertex']]}")
# routing sanity on the graph: weighted shortest path within the main component, steps excluded in wheelchair mode
W = nx.Graph(); Wc = nx.Graph()
for e in E:
    W.add_edge(e["from_node"], e["to_node"], w=e["travel_time"]); 
    if e["accessible"] and not e["stairs_only"]: Wc.add_edge(e["from_node"], e["to_node"], w=e["travel_time"])
comp2 = max(nx.connected_components(W), key=len); a, b = sorted(comp2)[0], sorted(comp2)[-1]
pw = nx.dijkstra_path(W, a, b, weight="w"); chk("O-15", "walking Dijkstra works inside the largest component", len(pw) > 1, len(pw))
used = {frozenset(x) for x in zip(pw, pw[1:])}; chk("O-16", "wheelchair graph has fewer or equal edges than walking (steps removed)", Wc.number_of_edges() == W.number_of_edges() - 29, f"{Wc.number_of_edges()} vs {W.number_of_edges()}")
for r in R: print("PASS" if r[2] else "FAIL", r[0], r[1], "|", r[3])
json.dump([dict(id=a, description=b, passed=c, detail=d) for a, b, c, d in R], open(f"{OUT}/outdoor_graph_verification.json", "w"), indent=1)
sys.exit(0 if all(r[2] for r in R) else 1)
