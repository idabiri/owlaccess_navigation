// Route alternatives for /suggestions. Every alternative is a REAL path computed by the existing engine (route()),
// with its distance, time, turns and floor changes taken from that result; nothing is estimated or invented.
// Alternatives come from asking the same engine different, honest questions:
//   fastest            - cost = travel time (the default)
//   shortest           - cost = distance
//   other_vertical     - the elevator / stair links the fastest route used are excluded, so the other shaft is used
//   avoid_narrow       - corridors flagged "potentially narrow" in the data are excluded
//   step_free          - (walking only) stairs excluded
// Exclusions are internal "ALT-" obstacles used only to steer the search: they never appear in warnings or in
// appliedObstacles. Obstacle reports still affect routing only when verified (passed in as `extraObstacles`).
import { route, warningsFor, type RouteFound, type RouteResult, type RouteFailed, type UnifiedData, type UObstacle, type RouteOptions } from "./unifiedRouting";
import { buildPlan, type NavigationPlan } from "./instructions";

export type StrategyKind = "fastest" | "shortest" | "other_vertical" | "avoid_narrow" | "step_free";
/** serialisable: /navigate re-runs exactly this strategy, so a verified obstacle still triggers recalculation */
export interface Strategy { kind: StrategyKind; cost: "travel_time" | "distance"; excludeEdges: string[]; avoidStairs?: boolean }

export interface TripOptions {
  wheelchair: boolean; avoidStairs: boolean;
  applyObstacles: boolean; scenario?: string;
  /** verified obstacle reports turned into router obstacles (blockingObstacles) */
  extraObstacles?: UObstacle[];
}
export interface RouteSuggestion {
  id: string; strategy: Strategy; name: string; route: RouteFound; plan: NavigationPlan;
  turns: number; floorChanges: number; elevators: string[]; stairwells: number; narrowSegments: number;
  badges: string[]; reasons: string[]; recommended: boolean;
}
export type Priority = "fastest" | "shortest" | "fewest_turns";

const ALT = "ALT-EXCLUDE-";
const elevatorName = (nodeId: string) => { const m = nodeId.match(/_elev_(\d+)$/); return m ? `Elevator ${m[1]}` : null; };

/** Run one strategy through the real engine. Internal exclusions are removed from the result's obstacles and warnings. */
export function routeWithStrategy(d: UnifiedData, start: string, goal: string, trip: TripOptions, strategy: Strategy): RouteResult {
  const exclusions: UObstacle[] = strategy.excludeEdges.map((e, i) => ({ obstacle_id: `${ALT}${i}`, status: "verified", verified: true, affected_edge_id: e }));
  const extra = trip.extraObstacles ?? [];
  const data: UnifiedData = { ...d, obstacles: [...d.obstacles, ...extra, ...exclusions] };
  const opt: RouteOptions = {
    wheelchair: trip.wheelchair, avoidStairs: trip.avoidStairs || !!strategy.avoidStairs, scenario: trip.scenario || undefined,
    applyObstacles: trip.applyObstacles, cost: strategy.cost,
    // exclusions apply even when obstacle avoidance is switched off: they only shape the alternative, they are not obstacles
    obstacleIds: [...(trip.applyObstacles ? extra.map(o => o.obstacle_id) : []), ...exclusions.map(o => o.obstacle_id)],
  };
  let r: RouteResult;
  if (trip.applyObstacles || !exclusions.length) r = route(data, start, goal, opt);
  else {                                                           // obstacles off: keep only the exclusions active
    const onlyExcl: UnifiedData = { ...d, obstacles: [...d.obstacles, ...exclusions] };
    r = route(onlyExcl, start, goal, { ...opt, applyObstacles: true, scenario: undefined, obstacleIds: exclusions.map(o => o.obstacle_id) });
  }
  const applied = r.appliedObstacles.filter(id => !id.startsWith(ALT));
  if (!r.found) return { ...r, appliedObstacles: applied } as RouteFailed;
  const edges = new Map(d.edges.map(e => [e.edge_id, e]));
  const cleaned: RouteFound = { ...r, appliedObstacles: applied };
  cleaned.warnings = warningsFor(d, cleaned, r.links.map(id => edges.get(id)!), { ...opt, applyObstacles: trip.applyObstacles });
  return cleaned;
}

function describe(d: UnifiedData, r: RouteFound, plan: NavigationPlan) {
  const edges = new Map(d.edges.map(e => [e.edge_id, e]));
  const es = r.links.map(id => edges.get(id)!);
  const elevators = [...new Set(r.nodes.map(elevatorName).filter((x): x is string => !!x))];
  return {
    turns: plan.instructions.filter(i => i.kind === "turn-walk").length,
    floorChanges: plan.floorTransitions.length,
    elevators, stairwells: es.filter(e => e.edge_type === "staircase").length ? 1 : 0,
    narrowSegments: es.filter(e => e.potentially_narrow).length,
    verticalEdges: es.filter(e => e.vertical).map(e => e.edge_id),
    narrowEdgeIdsInData: d.edges.filter(e => e.potentially_narrow).map(e => e.edge_id),
  };
}

/** Real alternatives between two places, best first for the chosen priority. Returns the engine's failure when there is no route at all. */
export function suggestRoutes(d: UnifiedData, start: string, goal: string, trip: TripOptions, priority: Priority = "fastest",
  labels: { start?: string; goal?: string } = {}, opts: { preferAvoidNarrow?: boolean } = {}): { suggestions: RouteSuggestion[]; failure: RouteFailed | null } {
  const make = (kind: StrategyKind, extra: Partial<Strategy> = {}): Strategy => ({ kind, cost: "travel_time", excludeEdges: [], ...extra });
  const base = routeWithStrategy(d, start, goal, trip, make("fastest"));
  if (!base.found) return { suggestions: [], failure: base };
  const baseInfo = describe(d, base, buildPlan(d, base, labels.start, labels.goal));
  const strategies: Strategy[] = [make("fastest"), make("shortest", { cost: "distance" })];
  if (baseInfo.verticalEdges.length) strategies.push(make("other_vertical", { excludeEdges: baseInfo.verticalEdges }));
  if (baseInfo.narrowSegments) strategies.push(make("avoid_narrow", { excludeEdges: baseInfo.narrowEdgeIdsInData }));
  if (!trip.wheelchair && !trip.avoidStairs && base.usesStairs) strategies.push(make("step_free", { avoidStairs: true }));

  const seen = new Set<string>(), out: RouteSuggestion[] = [];
  for (const s of strategies) {
    const r = s.kind === "fastest" ? base : routeWithStrategy(d, start, goal, trip, s);
    if (!r.found) continue;
    const key = r.links.join("|"); if (seen.has(key)) continue; seen.add(key);
    const plan = buildPlan(d, r, labels.start, labels.goal), info = describe(d, r, plan);
    out.push({ id: `${s.kind}`, strategy: s, name: "", route: r, plan, turns: info.turns, floorChanges: info.floorChanges, elevators: info.elevators,
      stairwells: info.stairwells, narrowSegments: info.narrowSegments, badges: [], reasons: [], recommended: false });
  }

  // badges: every option that is best on a measure, and only when the options actually differ on it (ties share the badge)
  const award = (badge: string, f: (s: RouteSuggestion) => number) => {
    const vals = out.map(f), min = Math.min(...vals);
    if (vals.some(v => v !== min)) out.forEach((s, i) => { if (vals[i] === min) s.badges.push(badge); });
  };
  if (out.length > 1) {
    award("Fastest", s => s.route.travelTimeS); award("Shortest", s => s.route.distanceM);
    award("Fewest turns", s => s.turns); award("Fewest narrow segments", s => s.narrowSegments);
  }
  // recommended: by the user's priority (ties broken by time), and avoiding narrow corridors when asked and possible
  const score = (s: RouteSuggestion): [number, number] => {
    const narrowPenalty = opts.preferAvoidNarrow ? s.narrowSegments * 1e6 : 0;
    const main = priority === "shortest" ? s.route.distanceM : priority === "fewest_turns" ? s.turns * 1e3 + s.route.travelTimeS : s.route.travelTimeS;
    return [narrowPenalty + main, s.route.travelTimeS];
  };
  out.sort((a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1]; });
  out[0].recommended = true;

  const fastest = out.reduce((a, b) => (b.route.travelTimeS < a.route.travelTimeS ? b : a));
  const rec = out[0];
  for (const s of out) {
    s.name = s.recommended ? "Recommended route"
      : s.strategy.kind === "shortest" ? (s.route.distanceM < rec.route.distanceM ? "Shortest distance" : "Alternative path")
      : s.strategy.kind === "other_vertical" ? (s.elevators.length ? `Via ${s.elevators.join(" and ")}` : "Via the other stairwell")
      : s.strategy.kind === "avoid_narrow" ? "Avoids narrow corridors"
      : s.strategy.kind === "step_free" ? "Step-free option" : "Fastest route";
    const r = s.reasons;
    if (trip.wheelchair) r.push("Meets your wheelchair requirement: no steps or stairs, and only links marked accessible in the data.");
    else if (trip.avoidStairs) r.push("Meets your step-free requirement: no stairs.");
    if (s.recommended) {
      const metric = (x: RouteSuggestion) => (priority === "shortest" ? x.route.distanceM : priority === "fewest_turns" ? x.turns : x.route.travelTimeS);
      const what = priority === "shortest" ? "shortest walking distance" : priority === "fewest_turns" ? "fewest turns" : "quickest";
      const tied = out.filter(x => x !== s && metric(x) === metric(s)).length;
      r.push(out.length === 1 ? "The only route that meets your requirements." : tied ? `Tied for ${what} with ${tied} other option${tied > 1 ? "s" : ""}; listed first.` : `The ${what} of the options.`);
    }
    if (s !== rec && s.route.travelTimeS === rec.route.travelTimeS && s.route.distanceM === rec.route.distanceM)
      r.push("Same distance and time as the recommended route, along a different path.");
    else if (s.route.travelTimeS > fastest.route.travelTimeS) r.push(`${Math.round(s.route.travelTimeS - fastest.route.travelTimeS)} s slower than the fastest option.`);
    if (s.floorChanges) r.push(`${s.floorChanges} floor change${s.floorChanges > 1 ? "s" : ""} ${s.elevators.length ? `by ${s.elevators.join(" and ")}` : "by stairs"}.`);
    if (s.strategy.kind === "other_vertical") r.push("Uses a different elevator or stairwell from the fastest route, useful if that one is busy or out of service.");
    if (s.strategy.kind === "avoid_narrow") r.push("Avoids every corridor the data flags as potentially narrow.");
    else if (s.narrowSegments) r.push(`Passes ${s.narrowSegments} potentially narrow corridor segment${s.narrowSegments > 1 ? "s" : ""} (synthetic flag, unverified).`);
    if (s.strategy.kind === "step_free") r.push("Avoids all stairs, at the cost of time.");
    if (s.route.appliedObstacles.length) r.push(`Avoids verified obstacle${s.route.appliedObstacles.length > 1 ? "s" : ""} ${s.route.appliedObstacles.join(", ")}.`);
  }
  return { suggestions: out, failure: null };
}
