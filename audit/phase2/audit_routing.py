#!/usr/bin/env python3
"""
Routing audit. Compares (1) the package's Python router, (2) the package's TypeScript router (run under Node,
results in /tmp/audit_js/ts_all.json) and (3) an INDEPENDENT networkx implementation written here from the raw JSON + the
documented rules. Also checks invariants on every route and runs the named Phase-2 scenarios.
"""
import json, sys, collections, time, itertools, random
import networkx as nx
sys.path.insert(0, "/mnt/user-data/outputs/indoor-mapping/tools")
from indoor_routing import IndoorGraph

BD = "/mnt/user-data/outputs/indoor-mapping/buildings/BLD001"
OUT = "/mnt/user-data/outputs/audit"
J = lambda n: json.load(open(f"{BD}/{n}"))
nodes = {n["node_id"]: n for n in J("nodes.json")["nodes"]}; edges = {e["edge_id"]: e for e in J("edges.json")["edges"]}
conns = J("connections.json")["connections"]; ob = J("obstacles.json"); feats = J("features.json")["features"]; rooms = J("rooms.json")["rooms"]
OBS = {o["obstacle_id"]: o for o in ob["obstacles"]}; SCN = {s["scenario_id"]: s for s in ob["scenarios"]}
ent_node = {e["feature_id"]: e["node_id"] for e in feats["entrances"]}
eps = [e["feature_id"] for e in feats["entrances"]] + [r["room_id"] for r in rooms if r["navigable"]]
def node_of(ep): return ent_node.get(ep) or next(r["destination_node_id"] for r in rooms if r["room_id"] == ep)
EPN = {e: node_of(e) for e in eps}

# ---------------- independent reference implementation (spec-level, networkx)
def ref_graph(scn, wc):
    act = [OBS[i] for i in SCN[scn]["obstacle_ids"] if OBS[i]["status"] == "verified" and OBS[i]["verified"] is True]
    be = {o["affected_edge_id"] for o in act if "affected_edge_id" in o}
    bn = {n for o in act for n in ([o["location_node_id"]] if "location_node_id" in o else []) + o.get("affected_node_ids", [])}
    G = nx.Graph()
    ok = lambda n: n not in bn and not (wc and not nodes[n]["accessible"])
    for e in edges.values():
        if e["edge_id"] in be or (wc and (not e["accessible"] or e["stairs_only"])): continue
        G.add_edge(e["from_node"], e["to_node"], w=e["travel_time"], d=e["distance"])
    for c in conns:
        if wc and (not c["accessible"] or c["stairs_only"]): continue
        G.add_edge(c["from_node"], c["to_node"], w=c["travel_time"], d=c["distance"])
    G.remove_nodes_from([n for n in list(G.nodes) if not ok(n)])
    return G, ok

t0 = time.time()
g = IndoorGraph(BD)
TS = {(r[0], r[1], r[2], r[3]): r for r in json.load(open("/tmp/audit_js/ts_all.json"))}
stats = collections.Counter(); problems = []; ties = []; per_scn = collections.defaultdict(lambda: collections.Counter())
py_cache = {}
for scn in SCN:
    for wc in (False, True):
        G, ok = ref_graph(scn, wc)
        for i, a in enumerate(eps):
            na = EPN[a]
            dist = nx.single_source_dijkstra_path_length(G, na, weight="w") if (na in G and ok(na)) else {}
            for b in eps[i + 1:]:
                nb = EPN[b]
                py = g.route(a, b, wheelchair=wc, scenario=scn); py_cache[(scn, wc, a, b)] = py
                ts = TS[(scn, wc, a, b)]
                ref_found = nb in dist and ok(nb) and ok(na)
                ref_cost = dist.get(nb)
                stats["routes"] += 1
                # (a) python vs independent reference
                if py["found"] != ref_found or (ref_found and abs(py["total_cost"] - ref_cost) > 0.011):
                    problems.append(("py_vs_ref", scn, wc, a, b, py.get("total_cost"), ref_cost))
                # (b) python vs TS
                if py["found"] != bool(ts[4]): problems.append(("py_vs_ts_found", scn, wc, a, b, py["found"], ts[4])); continue
                if not py["found"]:
                    if py["reason"] != ts[5]: problems.append(("reason", scn, wc, a, b, py["reason"], ts[5]))
                    per_scn[(scn, wc)]["no_route"] += 1; continue
                per_scn[(scn, wc)]["found"] += 1
                if (py["travel_time_s"], py["distance_m"], py["uses_stairs"], py["uses_elevator"]) != (ts[5], ts[6], ts[7], ts[8]):
                    problems.append(("metrics", scn, wc, a, b, (py["travel_time_s"], py["distance_m"]), (ts[5], ts[6])))
                if py["nodes"] != ts[9].split(","):
                    # equal-cost alternative path?
                    ties.append((scn, wc, a, b)); stats["tie_path_differences"] += 1
                # (c) invariants
                nl = py["nodes"]
                for u, v in zip(nl, nl[1:]):
                    if not G.has_edge(u, v): problems.append(("path_uses_blocked_or_forbidden_link", scn, wc, a, b, u, v)); break
                if wc:
                    if py["uses_stairs"] or any(not nodes[n]["accessible"] for n in nl): problems.append(("wheelchair_invariant", scn, wc, a, b))
                # cost recomputed from the links
                tot = 0.0
                for l in py["links"]:
                    k, i_ = l.split(":", 1)
                    tot += edges[i_]["travel_time"] if k == "edge" else next(c for c in conns if c["connection_id"] == i_)["travel_time"]
                if abs(tot - py["total_cost"]) > 0.011: problems.append(("cost_recompute", scn, wc, a, b, tot, py["total_cost"]))
print("elapsed %.0fs" % (time.time() - t0))
print("routes compared:", stats["routes"], "| problems:", len(problems), "| equal-cost path differences (Python vs TS):", stats["tie_path_differences"])
for p in problems[:10]: print("  PROBLEM", p)

# ---------------- unverified / resolved obstacles must not alter any result
alt = 0
for wc in (False, True):
    for a, b in itertools.combinations(eps, 2):
        base = py_cache[("SCN-NORMAL", wc, a, b)]
        for scn in ("SCN-UNVERIFIED-ONLY", "SCN-RESOLVED-IGNORED"):
            r = py_cache[(scn, wc, a, b)]
            if (r["found"], r.get("nodes")) != (base["found"], base.get("nodes")): alt += 1
print("pairs whose route changed under unverified/resolved-only scenarios:", alt)

# ---------------- symmetry sample
random.seed(11); sym_bad = 0
for _ in range(400):
    a, b = random.sample(eps, 2); wc = random.random() < .5; scn = random.choice(list(SCN))
    x = g.route(a, b, wheelchair=wc, scenario=scn); y = g.route(b, a, wheelchair=wc, scenario=scn)
    if x["found"] != y["found"] or (x["found"] and abs(x["total_cost"] - y["total_cost"]) > 0.011): sym_bad += 1
print("asymmetric results in 400 random reversed pairs:", sym_bad)

# ---------------- scenario impact table
print("\nper scenario/mode (pairs: found / no route) out of", len(list(itertools.combinations(eps, 2))))
for (s, wc), c in sorted(per_scn.items()): print(f"  {s:22s} {'wheelchair' if wc else 'walking   '} found={c['found']:4d} no_route={c['no_route']:4d}")

# ---------------- named Phase-2 scenarios (endpoints deliberately different from the package's own tests)
T = []
def run(tid, desc, a, b, wc, scn, expect):
    r = g.route(a, b, wheelchair=wc, scenario=scn)
    got = ("FOUND" if r["found"] else r["reason"])
    ok = expect(r)
    T.append(dict(id=tid, description=desc, start=a, start_node=g.resolve(a), goal=b, goal_node=g.resolve(b), mode="wheelchair" if wc else "walking", scenario=scn or "none",
                  result=got, time_s=r.get("travel_time_s"), distance_m=r.get("distance_m"), floors=r.get("floors"), uses_stairs=r.get("uses_stairs"), uses_elevator=r.get("uses_elevator"), passed=bool(ok), applied=r["applied_obstacles"]))
run("A-01", "room-to-room, same floor: room_104 -> room_113", "room_104", "room_113", False, None, lambda r: r["found"] and r["floors"] == ["BLD001_F1"])
run("A-02", "room-to-room, same floor F3: room_303 -> room_317", "room_303", "room_317", True, None, lambda r: r["found"] and r["floors"] == ["BLD001_F3"])
run("A-03", "entrance-to-room: entrance_2 -> room_115 (walking)", "entrance_2", "room_115", False, None, lambda r: r["found"])
run("A-04", "entrance-to-room: entrance_3 (ramp) -> room_113 (wheelchair)", "entrance_3", "room_113", True, None, lambda r: r["found"] and any(l.startswith("edge:") and edges[l[5:]]["edge_type"] == "ramp" for l in r["links"]))
run("A-05", "floor-to-floor: room_103 -> room_212 (walking)", "room_103", "room_212", False, None, lambda r: r["found"] and len(r["floors"]) == 2)
run("A-06", "floor-to-floor via elevator: room_103 -> room_212 (wheelchair)", "room_103", "room_212", True, None, lambda r: r["found"] and r["uses_elevator"] and not r["uses_stairs"])
run("A-07", "F2 -> F3 via elevator: room_219 -> room_315 (wheelchair)", "room_219", "room_315", True, None, lambda r: r["found"] and r["floors"] == ["BLD001_F2", "BLD001_F3"] and r["uses_elevator"])
run("A-08", "F1 -> F3 two hops: entrance_1 -> room_301 (wheelchair)", "entrance_1", "room_301", True, None, lambda r: r["found"] and len(r["floors"]) == 3)
base = g.route("room_111", "room_117", wheelchair=False)
run("A-09", "blocked hallway reroute (walking): room_111 -> room_117 under OBS-001", "room_111", "room_117", False, "SCN-BLOCKED-HALLWAY",
    lambda r: r["found"] and r["links"] != base["links"] and OBS["OBS-001"]["affected_edge_id"] not in [l[5:] for l in r["links"]] and r["travel_time_s"] >= base["travel_time_s"])
base_w = g.route("room_111", "room_117", wheelchair=True)
run("A-10", "blocked hallway reroute (wheelchair): room_111 -> room_117", "room_111", "room_117", True, "SCN-BLOCKED-HALLWAY",
    lambda r: r["found"] and r["links"] != base_w["links"] and OBS["OBS-001"]["affected_edge_id"] not in [l[5:] for l in r["links"]])
run("A-11", "one elevator unavailable: room_105 -> room_305 (wheelchair)", "room_105", "room_305", True, "SCN-ELEVATOR-1-OUT",
    lambda r: r["found"] and all("elev_1" not in n for n in r["nodes"]) and any("elev_2" in n for n in r["nodes"]))
run("A-12", "both elevators unavailable: entrance_2 -> room_301 (wheelchair) -> NO_ACCESSIBLE_ROUTE", "entrance_2", "room_301", True, "SCN-NO-ELEVATOR", lambda r: (not r["found"]) and r["reason"] == "NO_ACCESSIBLE_ROUTE")
run("A-13", "both elevators unavailable, walking uses stairs: entrance_2 -> room_301", "entrance_2", "room_301", False, "SCN-NO-ELEVATOR", lambda r: r["found"] and r["uses_stairs"])
run("A-14", "no accessible route from the steps entrance: entrance_4 -> room_119 (wheelchair)", "entrance_4", "room_119", True, None, lambda r: (not r["found"]) and r["reason"] == "NO_ACCESSIBLE_ROUTE")
run("A-15", "unverified blocked doorway must not block: room_104 -> room_103", "room_104", "room_103", True, "SCN-UNVERIFIED-ONLY", lambda r: r["found"] and r["applied_obstacles"] == [])
run("A-16", "verified construction isolates room_119 (walking) -> NO_ROUTE", "entrance_1", "room_119", False, "SCN-CONSTRUCTION", lambda r: (not r["found"]) and r["reason"] == "NO_ROUTE")
run("A-17", "stairwell destination is not reachable in wheelchair mode", "entrance_1", "room_109", True, None, lambda r: (not r["found"]) and r["reason"] == "NO_ACCESSIBLE_ROUTE")
print("\nnamed scenarios:", sum(t["passed"] for t in T), "/", len(T), "passed")
for t in T:
    if not t["passed"]: print("  FAIL", t["id"], t["description"], t["result"])
json.dump(dict(summary=dict(routes_compared=stats["routes"], problems=[list(map(str, p)) for p in problems], equal_cost_path_differences=stats["tie_path_differences"],
          unverified_or_resolved_changed_routes=alt, asymmetric=sym_bad), named=T,
          per_scenario={f"{s}|{'wheelchair' if wc else 'walking'}": dict(c) for (s, wc), c in per_scn.items()},
          tie_examples=[list(map(str, t)) for t in ties[:25]]), open(f"{OUT}/phase2_routing_results.json", "w"), indent=1)
