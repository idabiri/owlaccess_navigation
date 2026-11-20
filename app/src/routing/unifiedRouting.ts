// SYNTHETIC / MOCK indoor data + provisional outdoor connectors. Unified Dijkstra over outdoor + indoor + connector edges.
// Behaviour mirrors integration/tools/unified_routing.py exactly (checked by integration/tools/parity_unified).

export interface UNode {
  node_id: string; domain: "indoor" | "outdoor"; building_id: string | null; floor_id: string | null; node_type: string;
  x?: number; y?: number; lon?: number; lat?: number; room_id: string | null; accessible: boolean; provisional?: boolean;
}
export interface UEdge {
  edge_id: string; from_node: string; to_node: string; distance: number; travel_time: number; edge_type: string;
  domain: "indoor" | "outdoor" | "connector"; floor_id: string | null; accessible: boolean; stairs_only: boolean; vertical: boolean;
  provisional: boolean; potentially_narrow: boolean; synthetic: boolean; from_floor?: string; to_floor?: string; osm_way?: string; space_id?: string | null;
}
export interface UObstacle { obstacle_id: string; status: "pending" | "verified" | "resolved"; verified: boolean; location_node_id?: string; affected_edge_id?: string; affected_node_ids?: string[]; obstacle_type?: string; description?: string; floor_id?: string }
export interface UScenario { scenario_id: string; description?: string; obstacle_ids: string[] }
export interface EndpointMeta { id: string; label: string; domain: "indoor" | "outdoor"; floor_id: string | null; kind: string; room_type?: string }
export interface UnifiedData {
  nodes: UNode[]; edges: UEdge[]; obstacles: UObstacle[]; scenarios: UScenario[]; endpoints: Record<string, string>; endpoints_meta: EndpointMeta[];
}
export interface RouteOptions {
  wheelchair?: boolean;            // excludes stairs, inaccessible edges and nodes (inaccessible entrances, stair landings)
  avoidStairs?: boolean;           // excludes stair edges only (walking mode otherwise unrestricted)
  scenario?: string; obstacleIds?: string[];
  applyObstacles?: boolean;        // default true; false = ignore ALL obstacles (UI toggle). Unverified obstacles never block either way.
  cost?: "travel_time" | "distance";
}
export type FailReason = "NO_ROUTE" | "NO_ACCESSIBLE_ROUTE";
export interface Warning { code: string; message: string }
export interface RouteFound {
  found: true; nodes: string[]; links: string[]; travelTimeS: number; distanceM: number; usesStairs: boolean; usesElevator: boolean; usesRamp: boolean;
  floors: string[]; domains: string[]; appliedObstacles: string[]; warnings: Warning[];
}
export interface RouteFailed { found: false; reason: FailReason; appliedObstacles: string[]; warnings: Warning[] }
export type RouteResult = RouteFound | RouteFailed;

/** integer hundredths -> tenths, rounded half-up (same rule as Python) */
const halfUpTenths = (h: number) => Math.floor((h + 5) / 10) / 10;

class Heap {                                   // min-heap ordered by (cost, node id): same order as Python's heapq on (cost, id) tuples
  private a: [number, string][] = [];
  get size() { return this.a.length; }
  private lt(i: number, j: number) { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(v: [number, string]) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.lt(i, p)) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop(): [number, string] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.lt(l, m)) m = l; if (r < a.length && this.lt(r, m)) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}

export function resolveEndpoint(d: UnifiedData, ep: string): string {
  if (d.endpoints[ep]) return d.endpoints[ep];
  if (d.nodes.some(n => n.node_id === ep)) return ep;
  throw new Error(`cannot resolve endpoint ${ep}`);
}

export function activeObstacles(d: UnifiedData, opt: RouteOptions): UObstacle[] {
  if (opt.applyObstacles === false) return [];
  const ids = new Set(opt.obstacleIds ?? []);
  if (opt.scenario) {
    const sc = d.scenarios.find(s => s.scenario_id === opt.scenario);
    if (!sc) throw new Error(`unknown scenario ${opt.scenario}`);          // fail closed
    sc.obstacle_ids.forEach(i => ids.add(i));
  }
  const known = new Set(d.obstacles.map(o => o.obstacle_id));
  const unknown = [...ids].filter(i => !known.has(i)).sort();
  if (unknown.length) throw new Error(`unknown obstacle id(s) ${JSON.stringify(unknown)}`);
  // only verified obstacles block; pending / resolved / unverified never do
  return d.obstacles.filter(o => ids.has(o.obstacle_id) && o.status === "verified" && o.verified).sort((a, b) => (a.obstacle_id < b.obstacle_id ? -1 : 1));
}

export function route(d: UnifiedData, start: string, goal: string, opt: RouteOptions = {}): RouteResult {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n]));
  const wc = !!opt.wheelchair, byDist = opt.cost === "distance";
  const act = activeObstacles(d, opt);
  const blockedEdges = new Set(act.flatMap(o => (o.affected_edge_id ? [o.affected_edge_id] : [])));
  const blockedNodes = new Set(act.flatMap(o => [...(o.location_node_id ? [o.location_node_id] : []), ...(o.affected_node_ids ?? [])]));
  const applied = act.map(o => o.obstacle_id);
  const fail: RouteFailed = { found: false, reason: wc ? "NO_ACCESSIBLE_ROUTE" : "NO_ROUTE", appliedObstacles: applied, warnings: [] };
  const nodeOk = (n: string) => !blockedNodes.has(n) && !(wc && !nodes.get(n)!.accessible);
  const s = resolveEndpoint(d, start), g = resolveEndpoint(d, goal);
  if (!nodeOk(s) || !nodeOk(g)) return fail;

  type Link = { to: string; w: number; e: UEdge };
  const adj = new Map<string, Link[]>();
  for (const e of d.edges) {
    if (blockedEdges.has(e.edge_id)) continue;
    if (wc && (!e.accessible || e.stairs_only)) continue;
    if (opt.avoidStairs && e.stairs_only) continue;
    if (!nodes.has(e.from_node) || !nodes.has(e.to_node)) continue;
    const w = byDist ? e.distance : e.travel_time;
    (adj.get(e.from_node) ?? adj.set(e.from_node, []).get(e.from_node)!).push({ to: e.to_node, w, e });
    (adj.get(e.to_node) ?? adj.set(e.to_node, []).get(e.to_node)!).push({ to: e.from_node, w, e });
  }
  const dist = new Map<string, number>([[s, 0]]), prev = new Map<string, { from: string; e: UEdge }>(), h = new Heap();
  h.push([0, s]);
  while (h.size) {
    const [du, u] = h.pop();
    if (du > (dist.get(u) ?? Infinity)) continue;
    if (u === g) break;
    for (const l of adj.get(u) ?? []) {
      if (!nodeOk(l.to)) continue;
      const nd = du + l.w;
      if (nd < (dist.get(l.to) ?? Infinity)) { dist.set(l.to, nd); prev.set(l.to, { from: u, e: l.e }); h.push([nd, l.to]); }
    }
  }
  if (!dist.has(g)) return { ...fail };
  const path = [g], es: UEdge[] = [];
  for (let cur = g; cur !== s;) { const p = prev.get(cur)!; es.unshift(p.e); path.unshift(p.from); cur = p.from; }
  const tt = es.reduce((a, e) => a + Math.round(e.travel_time * 100), 0), dd = es.reduce((a, e) => a + Math.round(e.distance * 100), 0);
  const floors = [...new Set(path.map(n => nodes.get(n)!.floor_id).filter((f): f is string => !!f))].sort();
  const domains = [...new Set(path.map(n => nodes.get(n)!.domain))].sort();
  const res: RouteFound = {
    found: true, nodes: path, links: es.map(e => e.edge_id), travelTimeS: halfUpTenths(tt), distanceM: halfUpTenths(dd),
    usesStairs: es.some(e => e.edge_type === "staircase" || e.edge_type === "stair_landing" || e.edge_type === "steps" || e.edge_type === "entrance_steps" || e.stairs_only),
    usesElevator: es.some(e => e.edge_type === "elevator"), usesRamp: es.some(e => e.edge_type === "ramp"), floors, domains, appliedObstacles: applied, warnings: [],
  };
  res.warnings = warningsFor(d, res, es, opt);
  return res;
}

export function warningsFor(d: UnifiedData, r: RouteFound, es: UEdge[], opt: RouteOptions): Warning[] {
  const w: Warning[] = [];
  if (es.some(e => e.domain === "indoor")) w.push({ code: "SYNTHETIC_INDOOR", message: "The indoor part of this route uses SYNTHETIC / MOCK floor plans; it is not an official KSU plan." });
  if (es.some(e => e.provisional)) w.push({ code: "PROVISIONAL_ENTRANCE", message: "This route uses a provisional building entrance whose real-world position and accessibility are not verified in the field." });
  if (es.some(e => e.domain === "outdoor" && e.edge_type !== "steps")) w.push({ code: "OUTDOOR_ACCESSIBILITY_UNKNOWN", message: "Outdoor surface, slope and kerb accessibility are unknown: the source data only identifies steps." });
  const narrow = es.filter(e => e.potentially_narrow).length;
  if (narrow) w.push({ code: "POTENTIALLY_NARROW", message: `${narrow} hallway segment(s) on this route are flagged as potentially narrow (synthetic, unverified).` });
  if (r.usesRamp) w.push({ code: "RAMP_SLOPE_UNKNOWN", message: "The route uses a ramp whose slope and length are not modeled." });
  if (r.usesElevator) w.push({ code: "ELEVATOR_UNVERIFIED", message: "The route relies on elevators whose availability is not verified (demo obstacles aside)." });
  if (r.appliedObstacles.length) w.push({ code: "OBSTACLES_APPLIED", message: `Verified obstacle(s) were avoided: ${r.appliedObstacles.join(", ")}.` });
  if (opt.applyObstacles === false) w.push({ code: "OBSTACLES_IGNORED", message: "Obstacle avoidance is switched off: verified obstacles were NOT considered." });
  w.push({ code: "NOT_FIELD_VERIFIED", message: "Accessibility flags on this route have not been field-verified." });
  return w;
}
