#!/usr/bin/env python3
"""Python vs TypeScript parity for the unified router. usage: parity_unified.py <unified_graph.json> <unifiedRouting.ts> <work_dir> [n_cases]
Needs `tsc` and `node` on PATH. Exit 1 on any difference."""
import sys, json, random, subprocess, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from unified_routing import UnifiedGraph
gp, ts, wd = sys.argv[1:4]; N = int(sys.argv[4]) if len(sys.argv) > 4 else 2500
os.makedirs(wd, exist_ok=True); g = UnifiedGraph(gp); rnd = random.Random(2026)
eps = sorted(g.endpoints); outdoor = sorted(n for n, v in g.nodes.items() if v["domain"] == "outdoor" and v["component_id"] == "C02"); eps += rnd.sample(outdoor, 40)
scn = [None] + sorted(g.scenarios)
cases = []
for _ in range(N):
    a, b = rnd.sample(eps, 2)
    cases.append(dict(a=a, b=b, wc=rnd.random() < .4, avoid=rnd.random() < .2, scn=rnd.choice(scn), apply=rnd.random() < .9, cost=rnd.choice(["travel_time", "distance"])))
json.dump(cases, open(f"{wd}/cases.json", "w"))
open(f"{wd}/package.json", "w").write('{"type":"module"}')
subprocess.run(["tsc", "--target", "ES2020", "--module", "ES2020", "--strict", "--outDir", wd, ts], check=True)
open(f"{wd}/run.mjs", "w").write('''import fs from "fs"; import { route } from "./unifiedRouting.js";
const [gp, wd] = process.argv.slice(2); const d = JSON.parse(fs.readFileSync(gp)); const C = JSON.parse(fs.readFileSync(wd + "/cases.json"));
const out = C.map(c => { const r = route(d, c.a, c.b, { wheelchair: c.wc, avoidStairs: c.avoid, scenario: c.scn ?? undefined, applyObstacles: c.apply, cost: c.cost });
  return r.found ? [1, r.travelTimeS, r.distanceM, r.usesStairs, r.usesElevator, r.usesRamp, r.floors.join(","), r.domains.join(","), r.nodes.join(","), r.links.join(","), r.appliedObstacles.join(",")] : [0, r.reason, r.appliedObstacles.join(",")]; });
const closed = []; for (const o of [{ scenario: "SCN-TYPO" }, { obstacleIds: ["OBS-999"] }]) { try { route(d, "room_102", "room_103", o); closed.push("NO ERROR"); } catch { closed.push("throws"); } }
fs.writeFileSync(wd + "/ts_out.json", JSON.stringify({ out, closed }));''')
subprocess.run(["node", f"{wd}/run.mjs", gp, wd], check=True)
T = json.load(open(f"{wd}/ts_out.json")); bad = []; found = 0
for c, t in zip(cases, T["out"]):
    r = g.route(c["a"], c["b"], wheelchair=c["wc"], avoid_stairs=c["avoid"], scenario=c["scn"], apply_obstacles=c["apply"], cost=c["cost"])
    py = [1, r["travel_time_s"], r["distance_m"], r["uses_stairs"], r["uses_elevator"], r["uses_ramp"], ",".join(r["floors"]), ",".join(r["domains"]), ",".join(r["nodes"]), ",".join(r["links"]), ",".join(r["applied_obstacles"])] if r["found"] else [0, r["reason"], ",".join(r["applied_obstacles"])]
    found += r["found"]
    if py != t: bad.append((c, py[:3], t[:3]))
fc = []
for kw in (dict(scenario="SCN-TYPO"), dict(obstacle_ids=["OBS-999"])):
    try: g.route("room_102", "room_103", **kw); fc.append("NO ERROR")
    except KeyError: fc.append("throws")
print(f"cases: {len(cases)} (found {found}, no-route {len(cases)-found}) | differences: {len(bad)} | fail-closed py={fc} ts={T['closed']}")
for b in bad[:5]: print("  DIFF", b)
sys.exit(1 if bad or fc != T["closed"] or fc != ["throws", "throws"] else 0)
