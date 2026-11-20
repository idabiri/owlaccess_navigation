#!/usr/bin/env python3
"""Dijkstra routing over the SYNTHETIC indoor graph (nodes/edges/connections/obstacles JSON)."""
import heapq, json, os

class IndoorGraph:
    def __init__(self, building_dir):
        ld = lambda n: json.load(open(os.path.join(building_dir, n)))
        self.nodes = {n["node_id"]: n for n in ld("nodes.json")["nodes"]}
        self.edges = {e["edge_id"]: e for e in ld("edges.json")["edges"]}
        self.conns = {c["connection_id"]: c for c in ld("connections.json")["connections"]}
        ob = ld("obstacles.json")
        self.obstacles = {o["obstacle_id"]: o for o in ob["obstacles"]}
        self.scenarios = {s["scenario_id"]: s for s in ob["scenarios"]}
        self.rooms = {r["room_id"]: r for r in ld("rooms.json")["rooms"]}
        self.entrance_nodes = {f["feature_id"]: f["node_id"] for f in ld("features.json")["features"]["entrances"]}

    def resolve(self, ep):
        if ep in self.nodes: return ep
        if ep in self.entrance_nodes: return self.entrance_nodes[ep]
        r = self.rooms.get(ep)
        if r and r.get("destination_node_id"): return r["destination_node_id"]
        raise KeyError(f"cannot resolve endpoint {ep}")

    def active_obstacles(self, scenario=None, obstacle_ids=None):
        ids = set(obstacle_ids or [])
        if scenario: ids |= set(self.scenarios[scenario]["obstacle_ids"])
        # rule: only verified obstacles block; pending / resolved / unverified never do
        return [self.obstacles[i] for i in sorted(ids) if self.obstacles[i]["status"] == "verified" and self.obstacles[i]["verified"]]

    def route(self, start, goal, wheelchair=False, scenario=None, obstacle_ids=None, cost="travel_time"):
        s, g = self.resolve(start), self.resolve(goal)
        blocked_edges, blocked_nodes = set(), set()
        act = self.active_obstacles(scenario, obstacle_ids)
        for o in act:
            if o.get("affected_edge_id"): blocked_edges.add(o["affected_edge_id"])
            if o.get("location_node_id"): blocked_nodes.add(o["location_node_id"])
            blocked_nodes.update(o.get("affected_node_ids", []))
        fail = "NO_ACCESSIBLE_ROUTE" if wheelchair else "NO_ROUTE"
        res = dict(found=False, reason=fail, wheelchair=wheelchair, scenario=scenario,
                   applied_obstacles=[o["obstacle_id"] for o in act], nodes=[], links=[])
        def node_ok(n):
            if n in blocked_nodes: return False
            return not (wheelchair and not self.nodes[n]["accessible"])
        if not (node_ok(s) and node_ok(g)): return res
        adj = {}
        def add(a, b, w, link):
            if a not in self.nodes or b not in self.nodes: return   # ignore dangling references (reported by the validator)
            adj.setdefault(a, []).append((b, w, link)); adj.setdefault(b, []).append((a, w, link))
        for e in self.edges.values():
            if e["edge_id"] in blocked_edges: continue
            if wheelchair and (not e["accessible"] or e["stairs_only"]): continue
            add(e["from_node"], e["to_node"], e[cost], ("edge", e["edge_id"]))
        for c in self.conns.values():
            if wheelchair and (not c["accessible"] or c["stairs_only"]): continue
            add(c["from_node"], c["to_node"], c["travel_time"] if cost == "travel_time" else c["distance"], ("conn", c["connection_id"]))
        dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18): continue
            if u == g: break
            for v, w, link in adj.get(u, []):
                if not node_ok(v): continue
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd; prev[v] = (u, link); heapq.heappush(pq, (nd, v))
        if g not in dist: return res
        path, links, cur = [g], [], g
        while cur != s:
            cur, link = prev[cur][0], prev[cur][1]; links.append(link); path.append(cur)
        path.reverse(); links.reverse()
        tt = dd = 0.0
        for kind, i in links:
            if kind == "edge": tt += self.edges[i]["travel_time"]; dd += self.edges[i]["distance"]
            else: tt += self.conns[i]["travel_time"]; dd += self.conns[i]["distance"]
        ctypes = [self.conns[i]["connection_type"] for k, i in links if k == "conn"]
        res.update(found=True, reason=None, nodes=path, links=[f"{k}:{i}" for k, i in links], total_cost=round(dist[g], 2),
                   travel_time_s=round(tt, 1), distance_m=round(dd, 1), uses_stairs=("staircase" in ctypes),
                   uses_elevator=("elevator" in ctypes), floors=sorted({self.nodes[n]["floor_id"] for n in path}))
        return res
