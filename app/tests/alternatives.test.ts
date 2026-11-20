import { describe, it, expect } from "vitest";
import { suggestRoutes, routeWithStrategy, type TripOptions } from "../src/routing/alternatives";
import { route } from "../src/routing/unifiedRouting";
import { createReport, snapToEdge, verifyReport, blockingObstacles } from "../src/reports/obstacleReports";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const d = data.unified;
const edges = new Map(d.edges.map(e => [e.edge_id, e]));
const trip = (o: Partial<TripOptions> = {}): TripOptions => ({ wheelchair: false, avoidStairs: false, applyObstacles: true, ...o });
const halfUp = (h: number) => Math.floor((h + 5) / 10) / 10;
const PAIRS: [string, string, Partial<TripOptions>][] = [
  ["room_102", "room_302", { wheelchair: true }], ["oe_ENT007", "room_302", { wheelchair: true }], ["room_102", "room_302", {}],
  ["room_111", "room_117", {}], ["room_105", "room_113", { wheelchair: true }], ["entrance_1", "room_215", { avoidStairs: true }],
];

describe("route alternatives come from the real engine (nothing invented)", () => {
  for (const [a, b, o] of PAIRS) it(`${a} -> ${b} ${JSON.stringify(o)}`, () => {
    const { suggestions, failure } = suggestRoutes(d, a, b, trip(o));
    expect(failure).toBeNull(); expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.filter(s => s.recommended)).toHaveLength(1);
    expect(new Set(suggestions.map(s => s.route.links.join("|"))).size).toBe(suggestions.length);       // no duplicate paths
    for (const s of suggestions) {
      const es = s.route.links.map(id => edges.get(id)!);
      expect(es.every(Boolean)).toBe(true);                                                              // every link exists in the graph
      // the path is connected end to end, from start to goal
      expect(s.route.nodes[0]).toBe(d.endpoints[a] ?? a); expect(s.route.nodes.at(-1)).toBe(d.endpoints[b] ?? b);
      es.forEach((e, i) => expect([e.from_node, e.to_node].sort()).toEqual([s.route.nodes[i], s.route.nodes[i + 1]].sort()));
      // metrics recomputed from the edges equal what is shown
      expect(s.route.distanceM).toBe(halfUp(es.reduce((t, e) => t + Math.round(e.distance * 100), 0)));
      expect(s.route.travelTimeS).toBe(halfUp(es.reduce((t, e) => t + Math.round(e.travel_time * 100), 0)));
      expect(s.floorChanges).toBe(s.plan.floorTransitions.length);
      // requirements are rules
      if (o.wheelchair) { expect(s.route.usesStairs).toBe(false); expect(es.every(e => e.accessible && !e.stairs_only)).toBe(true); }
      if (o.avoidStairs) expect(s.route.usesStairs).toBe(false);
      // internal exclusions never leak out as "obstacles"
      expect(s.route.appliedObstacles.some(x => x.startsWith("ALT"))).toBe(false);
      expect(JSON.stringify(s.route.warnings)).not.toMatch(/ALT-/);
      // the same strategy reproduces the same path (what /navigate relies on)
      const again = routeWithStrategy(d, a, b, trip(o), s.strategy);
      expect(again.found && again.links).toEqual(s.route.links);
    }
    // the recommended (fastest priority) route is the engine's own fastest route
    const plain = route(d, a, b, { wheelchair: !!o.wheelchair, avoidStairs: !!o.avoidStairs });
    expect(plain.found && suggestions[0].route.links).toEqual(plain.found && plain.links);
  });

  it("offers the other elevator when the fastest wheelchair route uses one", () => {
    const { suggestions } = suggestRoutes(d, "room_102", "room_302", trip({ wheelchair: true }));
    const [first, other] = [suggestions[0], suggestions.find(s => s.strategy.kind === "other_vertical")];
    expect(first.elevators).toHaveLength(1); expect(other).toBeDefined();
    expect(other!.elevators).not.toEqual(first.elevators);
    expect(other!.name).toBe(`Via ${other!.elevators.join(" and ")}`);
  });
  it("walking routes that use stairs get a step-free option", () => {
    const { suggestions } = suggestRoutes(d, "room_102", "room_302", trip());
    expect(suggestions[0].route.usesStairs).toBe(true);
    const sf = suggestions.find(s => s.strategy.kind === "step_free");
    expect(sf && sf.route.usesStairs).toBe(false);
  });
  it("priority 'shortest' recommends the shortest option; 'fewest turns' the fewest turns", () => {
    for (const [a, b, o] of PAIRS) {
      const sh = suggestRoutes(d, a, b, trip(o), "shortest").suggestions, ft = suggestRoutes(d, a, b, trip(o), "fewest_turns").suggestions;
      expect(sh[0].route.distanceM).toBe(Math.min(...sh.map(s => s.route.distanceM)));
      expect(ft[0].turns).toBe(Math.min(...ft.map(s => s.turns)));
    }
  });
  it("only verified reports change suggestions; a verified one reroutes every option", () => {
    const draft = snapToEdge(d, "BLD001_F1", 275, 440.5)!;
    const pending = createReport(draft, "blocked_hallway", "cart");
    const base = suggestRoutes(d, "room_105", "room_113", trip({ wheelchair: true })).suggestions;
    const withPending = suggestRoutes(d, "room_105", "room_113", trip({ wheelchair: true, extraObstacles: blockingObstacles([pending], true) })).suggestions;
    expect(withPending[0].route.links).toEqual(base[0].route.links);
    const v = verifyReport(pending, "blocked_hallway", "blocks_everyone");
    const withVerified = suggestRoutes(d, "room_105", "room_113", trip({ wheelchair: true, extraObstacles: blockingObstacles([v], true) })).suggestions;
    for (const s of withVerified) { expect(s.route.links).not.toContain(draft.affected_edge_id); expect(s.route.appliedObstacles).toContain(v.report_id); }
  });
  it("returns the engine's NO_ACCESSIBLE_ROUTE instead of inventing a route", () => {
    const r = suggestRoutes(d, "room_102", "room_302", trip({ wheelchair: true, scenario: "SCN-NO-ELEVATOR" }));
    expect(r.suggestions).toEqual([]); expect(r.failure?.reason).toBe("NO_ACCESSIBLE_ROUTE");
  });
  it("with obstacle avoidance off, alternatives still work and say obstacles were NOT considered", () => {
    const r = suggestRoutes(d, "room_102", "room_302", trip({ wheelchair: true, applyObstacles: false, scenario: "SCN-NO-ELEVATOR" }));
    expect(r.failure).toBeNull();
    for (const s of r.suggestions) expect(s.route.warnings.map(w => w.code)).toContain("OBSTACLES_IGNORED");
  });
});
