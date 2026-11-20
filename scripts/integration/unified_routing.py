"""Python reference for the unified router. Must behave exactly like app/src/routing/unifiedRouting.ts (see tools/parity_unified.py)."""
import heapq, json

class UnifiedGraph:
    def __init__(self, path):
        d = json.load(open(path))
        self.nodes = {n["node_id"]: n for n in d["nodes"]}; self.edges = d["edges"]
        self.obstacles = {o["obstacle_id"]: o for o in d["obstacles"]}; self.scenarios = {s["scenario_id"]: s for s in d["scenarios"]}
        self.endpoints = d["endpoints"]

    def resolve(self, ep):
        if ep in self.endpoints: return self.endpoints[ep]
        if ep in self.nodes: return ep
        raise KeyError(f"cannot resolve endpoint {ep}")

    def active_obstacles(self, scenario=None, obstacle_ids=None, apply_obstacles=True):
        if not apply_obstacles: return []
        ids = set(obstacle_ids or [])
        if scenario:
            if scenario not in self.scenarios: raise KeyError(f"unknown scenario {scenario}")
            ids |= set(self.scenarios[scenario]["obstacle_ids"])
        unknown = sorted(i for i in ids if i not in self.obstacles)
        if unknown: raise KeyError(f"unknown obstacle id(s) {unknown}")
        return [self.obstacles[i] for i in sorted(ids) if self.obstacles[i]["status"] == "verified" and self.obstacles[i]["verified"]]

    def route(self, start, goal, wheelchair=False, avoid_stairs=False, scenario=None, obstacle_ids=None, apply_obstacles=True, cost="travel_time"):
        act = self.active_obstacles(scenario, obstacle_ids, apply_obstacles)
        be = {o["affected_edge_id"] for o in act if o.get("affected_edge_id")}
        bn = set()
        for o in act:
            if o.get("location_node_id"): bn.add(o["location_node_id"])
            bn.update(o.get("affected_node_ids", []))
        res = dict(found=False, reason="NO_ACCESSIBLE_ROUTE" if wheelchair else "NO_ROUTE", applied_obstacles=[o["obstacle_id"] for o in act])
        ok = lambda n: n not in bn and not (wheelchair and not self.nodes[n]["accessible"])
        s, g = self.resolve(start), self.resolve(goal)
        if not (ok(s) and ok(g)): return res
        adj = {}
        for e in self.edges:
            if e["edge_id"] in be: continue
            if wheelchair and (not e["accessible"] or e["stairs_only"]): continue
            if avoid_stairs and e["stairs_only"]: continue
            if e["from_node"] not in self.nodes or e["to_node"] not in self.nodes: continue
            w = e["distance"] if cost == "distance" else e["travel_time"]
            adj.setdefault(e["from_node"], []).append((e["to_node"], w, e)); adj.setdefault(e["to_node"], []).append((e["from_node"], w, e))
        dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, float("inf")): continue
            if u == g: break
            for v, w, e in adj.get(u, []):
                if not ok(v): continue
                nd = d + w
                if nd < dist.get(v, float("inf")): dist[v] = nd; prev[v] = (u, e); heapq.heappush(pq, (nd, v))
        if g not in dist: return res
        path, es, cur = [g], [], g
        while cur != s: cur, e = prev[cur]; es.append(e); path.append(cur)
        path.reverse(); es.reverse()
        tt = sum(round(e["travel_time"] * 100) for e in es); dd = sum(round(e["distance"] * 100) for e in es)
        floors = sorted({self.nodes[n]["floor_id"] for n in path if self.nodes[n]["floor_id"]}); domains = sorted({self.nodes[n]["domain"] for n in path})
        res.update(found=True, reason=None, nodes=path, links=[e["edge_id"] for e in es], travel_time_s=(tt + 5) // 10 / 10, distance_m=(dd + 5) // 10 / 10,
                   uses_stairs=any(e["edge_type"] in ("staircase", "stair_landing", "steps", "entrance_steps") or e["stairs_only"] for e in es),
                   uses_elevator=any(e["edge_type"] == "elevator" for e in es), uses_ramp=any(e["edge_type"] == "ramp" for e in es), floors=floors, domains=domains)
        return res
