#!/usr/bin/env python3
"""
Phases 5-6 data builder. READ-ONLY on all inputs. Writes:
  integration/indoor_outdoor_connectors.json, integration/unified_routing_graph.json, integration/buildings_marietta.geojson
usage: build_unified.py <uploads> <integration_dir> <indoor_building_dir>
"""
import json, sys, math, hashlib, collections
from pyproj import Transformer
from shapely.geometry import Polygon, Point
UP, D, IND = sys.argv[1:4]
J = lambda p: json.load(open(p))
rev = J(f"{D}/entrance_review.json"); on = J(f"{D}/outdoor_nodes.json")["nodes"]; oe = J(f"{D}/outdoor_edges.json")["edges"]; orep = J(f"{D}/outdoor_graph_report.json")
rooms = J(f"{IND}/rooms.json")["rooms"]; nodes = J(f"{IND}/nodes.json")["nodes"]; edges = J(f"{IND}/edges.json")["edges"]; conns = J(f"{IND}/connections.json")["connections"]
obs = J(f"{IND}/obstacles.json"); feats = J(f"{IND}/features.json")["features"]; old_conn = J(f"{IND}/connectors.json")["connectors"]
ON = {n["node_id"]: n for n in on}; REV = {e["feature_id"]: e for e in rev["entrances"]}
ATT = {r["feature_id"]: r for r in orep["entrance_attachment"]}
SHA = {f: hashlib.sha256(open(f"{UP}/{f}", "rb").read()).hexdigest() for f in ("buildings.geojson", "entrances_ramps.geojson", "sidewalks.geojson")}

# ---------------- Phase 5: connectors (decision per indoor entrance, from the review files; nothing guessed)
LINK = {"entrance_1": "ENT006", "entrance_2": "ENT007", "entrance_3": "RMP004", "entrance_4": None}
CONN = []
for ent in feats["entrances"]:
    k = ent["feature_id"]; src = LINK[k]; c = dict(connector_id=f"conn_out_{k}", building_id="BLD001", indoor_node_id=ent["node_id"], outdoor_node_id=None,
        connection_type=("accessible_entrance" if ent["accessible"] else "standard_entrance"), accessible=ent["accessible"], source=None, verified=False, synthetic=True,
        verification_status=None, status="unassigned", reason=None, indoor_feature_id=k, source_feature_id=src, entrance_review_status=None,
        distance=0.0, travel_time=2.0, cost_note="threshold allowance (synthetic): 0 m, 2 s")
    if src is None:
        c.update(source="none (invented indoor demo entrance)", verification_status="synthetic_demo", reason="synthetic_demo entrance: never connected to the outdoor graph", entrance_review_status="synthetic_demo")
    else:
        r = REV[src]; a = ATT[src]; c.update(source=f"entrances_ramps.geojson:{src}", entrance_review_status=r["review_status"])
        if a["outdoor_node"] is None:
            c.update(verification_status="needs_verification", reason=a["reason"] or "no outdoor entrance node")
        elif ON[a["outdoor_node"]].get("ambiguous_attachment"):
            c.update(verification_status="needs_review", reason=f"outdoor attachment is ambiguous between footways {ON[a['outdoor_node']]['ambiguous_alternatives']} and way {a['attached_way']}: held for human review",
                     candidate_outdoor_node_id=a["outdoor_node"])
        else:
            c.update(outdoor_node_id=a["outdoor_node"], status="assigned_provisional", verification_status="provisional_unverified", sidewalk_attachment_node=a["attachment_node"],
                     reason="source row within 5 m of the footprint, non-steps footway within 10 m, link crosses no building. Still unverified in the field.", accessible=bool(ent["accessible"] and REV[src]["source_accessible_flag"]))
    CONN.append(c)
json.dump(dict(schema_version="1.0.0", disclaimer="Indoor side is SYNTHETIC; outdoor side derived from unverified source rows. A connector is assigned only when the review files support it.", connectors=CONN),
          open(f"{D}/indoor_outdoor_connectors.json", "w"), indent=1)

# ---------------- Phase 6: unified graph
U_nodes, U_edges = [], []
for n in nodes:
    U_nodes.append(dict(node_id=n["node_id"], domain="indoor", building_id="BLD001", floor_id=n["floor_id"], node_type=n["node_type"], x=n["x"], y=n["y"], room_id=n["room_id"], accessible=n["accessible"], synthetic=True))
for n in on:
    U_nodes.append(dict(node_id=n["node_id"], domain="outdoor", building_id=n.get("building_id"), floor_id=None, node_type=n["node_type"], lon=n["lon"], lat=n["lat"], room_id=None,
                        accessible=True, synthetic=False, provisional=bool(n.get("provisional")), component_id=n["component_id"]))
SPACE = {r["room_id"]: r["room_name"] for r in rooms}
for e in edges:
    U_edges.append(dict(edge_id=e["edge_id"], from_node=e["from_node"], to_node=e["to_node"], distance=e["distance"], travel_time=e["travel_time"], edge_type=e["edge_type"], domain="indoor", floor_id=e["floor_id"],
                        accessible=e["accessible"], stairs_only=e["stairs_only"], vertical=False, verified=False, synthetic=True, provisional=False, potentially_narrow=e["potentially_narrow"], space_id=e["space_id"]))
for c in conns:
    U_edges.append(dict(edge_id=c["connection_id"], from_node=c["from_node"], to_node=c["to_node"], distance=c["distance"], travel_time=c["travel_time"], edge_type=c["connection_type"], domain="indoor", floor_id=None,
                        accessible=c["accessible"], stairs_only=c["stairs_only"], vertical=True, verified=False, synthetic=True, provisional=False, potentially_narrow=False, from_floor=c["from_floor"], to_floor=c["to_floor"]))
for e in oe:
    U_edges.append(dict(edge_id=e["edge_id"], from_node=e["from_node"], to_node=e["to_node"], distance=e["distance"], travel_time=e["travel_time"], edge_type=e["edge_type"], domain="outdoor", floor_id=None,
                        accessible=e["accessible"], stairs_only=e["stairs_only"], vertical=False, verified=False, synthetic=False, provisional=bool(e.get("provisional")), potentially_narrow=False, osm_way=e["osm_way"],
                        accessibility_basis=e["accessibility_basis"]))
for c in CONN:
    if c["status"] != "assigned_provisional": continue
    U_edges.append(dict(edge_id=c["connector_id"], from_node=c["outdoor_node_id"], to_node=c["indoor_node_id"], distance=c["distance"], travel_time=c["travel_time"], edge_type="building_connector", domain="connector", floor_id="BLD001_F1",
                        accessible=c["accessible"], stairs_only=False, vertical=False, verified=False, synthetic=True, provisional=True, potentially_narrow=False, connector_id=c["connector_id"]))
# endpoint index (what the UI/router may use as a start or destination)
EP, META = {}, []
for r in rooms:
    if r["navigable"]: EP[r["room_id"]] = r["destination_node_id"]; META.append(dict(id=r["room_id"], label=f"{r['room_name']}", domain="indoor", floor_id=r["floor_id"], kind="room", room_type=r["room_type"]))
for ent in feats["entrances"]: EP[ent["feature_id"]] = ent["node_id"]; META.append(dict(id=ent["feature_id"], label=f"Indoor {ent['feature_id']} ({'accessible' if ent['accessible'] else 'steps'}, synthetic)", domain="indoor", floor_id=ent["floor_id"], kind="building_entrance"))
for n in on:
    if n["node_type"] in ("entrance", "ramp_entrance"): EP[n["node_id"]] = n["node_id"]; META.append(dict(id=n["node_id"], label=f"Outdoor {n['source_feature_id']} (provisional)", domain="outdoor", floor_id=None, kind="outdoor_entrance"))
G = dict(schema_version="1.0.0", scope="Marietta campus", disclaimer="Indoor data is SYNTHETIC / MOCK. Outdoor data derived from unverified source files. Entrance connectors are provisional.", generated_from=SHA,
         cost=dict(primary="travel_time", also_stored="distance", connector_note="building_connector edges: 0 m / 2 s synthetic threshold allowance"),
         nodes=U_nodes, edges=U_edges, obstacles=obs["obstacles"], scenarios=obs["scenarios"], obstacle_rule=obs["rule"], endpoints=EP, endpoints_meta=META,
         connectors_ref="indoor_outdoor_connectors.json", counts=dict(nodes=len(U_nodes), edges=len(U_edges), indoor_nodes=len(nodes), outdoor_nodes=len(on), building_connectors=sum(c["status"] == "assigned_provisional" for c in CONN)))
json.dump(G, open(f"{D}/unified_routing_graph.json", "w"), indent=0, separators=(",", ":"))

# ---------------- Marietta building layer for the map (processed COPY of buildings.geojson)
B = J(f"{UP}/buildings.geojson"); ring = [f for f in B["features"] if f["properties"].get("building_id") == "BLD001"][0]["geometry"]["coordinates"][0]
clon = sum(c[0] for c in ring) / len(ring); clat = sum(c[1] for c in ring) / len(ring)
t = Transformer.from_crs("EPSG:4326", f"+proj=aeqd +lat_0={clat} +lon_0={clon} +datum=WGS84 +units=m", always_xy=True)
keep = []
for f in B["features"]:
    poly = Polygon([t.transform(*c) for c in f["geometry"]["coordinates"][0]])
    if poly.centroid.distance(Point(0, 0)) <= 1500:
        p = f["properties"]; keep.append(dict(type="Feature", geometry=f["geometry"], properties=dict(id=p.get("id"), name=p.get("name"), building_id=p.get("building_id"), building=p.get("building"), indoor_mapping=p.get("indoor_mapping"))))
json.dump(dict(type="FeatureCollection", name="buildings_marietta (processed copy, <=1.5 km of BLD001)", features=keep), open(f"{D}/buildings_marietta.geojson", "w"))
print("connectors:", [(c["indoor_feature_id"], c["status"], c["outdoor_node_id"], c["verification_status"]) for c in CONN])
print("unified:", G["counts"], "| endpoints:", len(EP), "| buildings kept:", len(keep), "of", len(B["features"]))
