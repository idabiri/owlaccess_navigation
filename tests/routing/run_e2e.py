"""Phase 8 E2E runner (Python router). Usage (from the repo root): python tests/routing/run_e2e.py -> writes tests/routing/results/e2e_python_results.json"""
import json, os, sys
# Repository copy of audit/phase8_e2e/run_e2e.py. Only the paths changed: the router now lives in scripts/integration/,
# the graph in data/integrated/, and results are written to tests/routing/results/ (the archived audit results are left alone).
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, "..", ".."); sys.path.insert(0, os.path.join(ROOT, "scripts", "integration"))
from unified_routing import UnifiedGraph
g = UnifiedGraph(os.path.join(ROOT, "data", "integrated", "unified_routing_graph.json"))
def run(s, over=None):
    o = dict(mode=s["mode"], scenario=s["scenario"]); o.update(over or {})
    return g.route(s["start"], s["goal"], wheelchair=o["mode"] == "wheelchair", scenario=o["scenario"])
def norm(r):
    if not r["found"]: return dict(found=False, reason=r["reason"], applied=r["applied_obstacles"])
    return dict(found=True, reason=None, applied=r["applied_obstacles"], time_s=r["travel_time_s"], distance_m=r["distance_m"], uses_stairs=r["uses_stairs"], uses_elevator=r["uses_elevator"], floors=r["floors"], domains=sorted(r["domains"]), nodes=r["nodes"], links=r["links"])
def check(exp, a, b):
    f = []
    def ck(name, ok): ok or f.append(name)
    ck("found", a["found"] == exp["found"])
    if "reason" in exp: ck("reason", a.get("reason") == exp["reason"])
    if "applied" in exp: ck("applied", a["applied"] == exp["applied"])
    if a["found"]:
        for k in ("uses_stairs", "uses_elevator", "floors"):
            if k in exp: ck(k, a[k] == exp[k])
        if "domains" in exp: ck("domains", a["domains"] == exp["domains"])
        for l in exp.get("links_include", []): ck("links_include:" + l, l in a["links"])
        for l in exp.get("links_exclude", []): ck("links_exclude:" + l, l not in a["links"])
        for n in exp.get("nodes_include", []): ck("nodes_include:" + n, n in a["nodes"])
        for n in exp.get("nodes_exclude", []): ck("nodes_exclude:" + n, n not in a["nodes"])
    if "baseline_found" in exp: ck("baseline_found", b["found"] == exp["baseline_found"])
    if "baseline_uses_stairs" in exp: ck("baseline_uses_stairs", b.get("uses_stairs") == exp["baseline_uses_stairs"])
    if exp.get("slower_than_baseline"): ck("slower_than_baseline", a["time_s"] > b["time_s"])
    if exp.get("same_as_baseline"): ck("same_as_baseline", a["nodes"] == b["nodes"] and a["time_s"] == b["time_s"])
    return f
if __name__ == "__main__":
    S = json.load(open(os.path.join(H, "scenarios.json")))["scenarios"]; out = []
    for s in S:
        a = norm(run(s)); b = norm(run(s, s["baseline"])) if "baseline" in s else None
        fails = check(s["expect"], a, b or {}); out.append(dict(id=s["id"], actual=a, baseline=b, failed_checks=fails, passed=not fails))
        print(("PASS " if not fails else "FAIL ") + s["id"], s["title"], fails or "")
    os.makedirs(os.path.join(H, "results"), exist_ok=True); json.dump(out, open(os.path.join(H, "results", "e2e_python_results.json"), "w"), indent=1)
    sys.exit(0 if all(o["passed"] for o in out) else 1)
