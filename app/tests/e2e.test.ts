import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { route } from "../src/routing/unifiedRouting";
import { loadFixtureData } from "./helpers";

const S = JSON.parse(readFileSync(resolve(__dirname, "fixtures/scenarios.json"), "utf8")).scenarios as any[];
const PY = JSON.parse(readFileSync(resolve(__dirname, "fixtures/e2e_python_results.json"), "utf8")) as any[];
const d = loadFixtureData();
const run = (s: any, over: any = {}) => { const o = { mode: s.mode, scenario: s.scenario, ...over }; return route(d.unified, s.start, s.goal, { wheelchair: o.mode === "wheelchair", scenario: o.scenario ?? undefined }); };
const norm = (r: any) => r.found ? { found: true, reason: null, applied: r.appliedObstacles, time_s: r.travelTimeS, distance_m: r.distanceM, uses_stairs: r.usesStairs, uses_elevator: r.usesElevator, floors: r.floors, domains: [...r.domains].sort(), nodes: r.nodes, links: r.links } : { found: false, reason: r.reason, applied: r.appliedObstacles };
const results: any[] = [];

describe("Phase 8 end-to-end routing scenarios (TypeScript router)", () => {
  for (const s of S) it(`${s.id} ${s.title}`, () => {
    const a = norm(run(s)) as any, b = s.baseline ? norm(run(s, s.baseline)) as any : null, e = s.expect, fails: string[] = [];
    const ck = (n: string, ok: boolean) => { if (!ok) fails.push(n); };
    ck("found", a.found === e.found);
    if ("reason" in e) ck("reason", a.reason === e.reason);
    if ("applied" in e) ck("applied", JSON.stringify(a.applied) === JSON.stringify(e.applied));
    if (a.found) {
      for (const k of ["uses_stairs", "uses_elevator", "floors"]) if (k in e) ck(k, JSON.stringify(a[k]) === JSON.stringify(e[k]));
      if (e.domains) ck("domains", JSON.stringify(a.domains) === JSON.stringify(e.domains));
      for (const l of e.links_include ?? []) ck("links_include:" + l, a.links.includes(l));
      for (const l of e.links_exclude ?? []) ck("links_exclude:" + l, !a.links.includes(l));
      for (const n of e.nodes_include ?? []) ck("nodes_include:" + n, a.nodes.includes(n));
      for (const n of e.nodes_exclude ?? []) ck("nodes_exclude:" + n, !a.nodes.includes(n));
    }
    if ("baseline_found" in e) ck("baseline_found", b.found === e.baseline_found);
    if ("baseline_uses_stairs" in e) ck("baseline_uses_stairs", b.uses_stairs === e.baseline_uses_stairs);
    if (e.slower_than_baseline) ck("slower_than_baseline", a.time_s > b.time_s);
    if (e.same_as_baseline) ck("same_as_baseline", JSON.stringify(a.nodes) === JSON.stringify(b.nodes) && a.time_s === b.time_s);
    const py = PY.find(p => p.id === s.id).actual;
    const parity = JSON.stringify(py) === JSON.stringify(a);       // Python and TS must agree exactly
    results.push({ id: s.id, actual: a, baseline: b, failed_checks: fails, python_ts_identical: parity, passed: fails.length === 0 && parity });
    expect(fails).toEqual([]);
    expect(parity).toBe(true);
  });
  it("writes results", () => { if (process.env.E2E_OUT) writeFileSync(process.env.E2E_OUT, JSON.stringify(results, null, 1)); });
});
