// SYNTHETIC / MOCK indoor routing (Dijkstra) - TypeScript port of tools/indoor_routing.py
export interface IndoorNode { node_id: string; floor_id: string; node_type: string; x: number; y: number; room_id: string | null; accessible: boolean }
export interface IndoorEdge { edge_id: string; from_node: string; to_node: string; distance: number; travel_time: number; edge_type: string; accessible: boolean; stairs_only: boolean }
export interface IndoorConnection { connection_id: string; from_node: string; to_node: string; connection_type: "elevator" | "staircase" | "ramp"; accessible: boolean; stairs_only?: boolean; travel_time: number; distance: number }
export interface IndoorObstacle { obstacle_id: string; status: "pending" | "verified" | "resolved"; verified: boolean; location_node_id?: string; affected_edge_id?: string; affected_node_ids?: string[] }
export interface IndoorScenario { scenario_id: string; obstacle_ids: string[] }
export interface IndoorRoom { room_id: string; destination_node_id: string | null }
export interface IndoorData {
  nodes: IndoorNode[]; edges: IndoorEdge[]; connections: IndoorConnection[];
  obstacles: IndoorObstacle[]; scenarios: IndoorScenario[]; rooms: IndoorRoom[]; entrances: Record<string, string>; // entrance_1 -> node id
}
export interface RouteOptions { wheelchair?: boolean; scenario?: string; obstacleIds?: string[] }
export type RouteResult =
  | { found: true; nodes: string[]; links: string[]; travelTimeS: number; distanceM: number; usesStairs: boolean; usesElevator: boolean; floors: string[]; appliedObstacles: string[] }
  | { found: false; reason: "NO_ROUTE" | "NO_ACCESSIBLE_ROUTE"; appliedObstacles: string[] };

export function route(d: IndoorData, start: string, goal: string, opt: RouteOptions = {}): RouteResult {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n]));
  const resolve = (ep: string): string => {
    if (nodes.has(ep)) return ep;
    if (d.entrances[ep]) return d.entrances[ep];
    const r = d.rooms.find(r => r.room_id === ep);
    if (r?.destination_node_id) return r.destination_node_id;
    throw new Error(`cannot resolve endpoint ${ep}`);
  };
  const wc = !!opt.wheelchair;
  const ids = new Set(opt.obstacleIds ?? []);
  if (opt.scenario) d.scenarios.find(s => s.scenario_id === opt.scenario)?.obstacle_ids.forEach(i => ids.add(i));
  // only verified obstacles block; pending / resolved / unverified never do
  const active = d.obstacles.filter(o => ids.has(o.obstacle_id) && o.status === "verified" && o.verified);
  const blockedEdges = new Set(active.flatMap(o => (o.affected_edge_id ? [o.affected_edge_id] : [])));
  const blockedNodes = new Set(active.flatMap(o => [...(o.location_node_id ? [o.location_node_id] : []), ...(o.affected_node_ids ?? [])]));
  const appliedObstacles = active.map(o => o.obstacle_id).sort();
  const fail = { found: false as const, reason: (wc ? "NO_ACCESSIBLE_ROUTE" : "NO_ROUTE") as "NO_ROUTE" | "NO_ACCESSIBLE_ROUTE", appliedObstacles };
  const nodeOk = (n: string) => !blockedNodes.has(n) && !(wc && !nodes.get(n)!.accessible);
  const s = resolve(start), g = resolve(goal);
  if (!nodeOk(s) || !nodeOk(g)) return fail;

  type Link = { to: string; w: number; id: string; t: number; dist: number; stairs: boolean; elev: boolean };
  const adj = new Map<string, Link[]>();
  const add = (a: string, b: string, l: Omit<Link, "to">) => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, ...l });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, ...l });
  };
  for (const e of d.edges) {
    if (blockedEdges.has(e.edge_id) || (wc && (!e.accessible || e.stairs_only))) continue;
    add(e.from_node, e.to_node, { w: e.travel_time, id: `edge:${e.edge_id}`, t: e.travel_time, dist: e.distance, stairs: false, elev: false });
  }
  for (const c of d.connections) {
    if (wc && (!c.accessible || c.stairs_only)) continue;
    add(c.from_node, c.to_node, { w: c.travel_time, id: `conn:${c.connection_id}`, t: c.travel_time, dist: c.distance, stairs: c.connection_type === "staircase", elev: c.connection_type === "elevator" });
  }
  // simple O(n^2) Dijkstra: the graph has a few hundred nodes; swap in a heap for larger data
  const dist = new Map<string, number>([[s, 0]]), prev = new Map<string, { from: string; l: Link }>(), done = new Set<string>();
  for (;;) {
    let u: string | null = null, best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
    if (u === null || u === g) break;
    done.add(u);
    for (const l of adj.get(u) ?? []) {
      if (!nodeOk(l.to)) continue;
      const nd = best + l.w;
      if (nd < (dist.get(l.to) ?? Infinity)) { dist.set(l.to, nd); prev.set(l.to, { from: u, l }); }
    }
  }
  if (!dist.has(g)) return fail;
  const path = [g], links: Link[] = [];
  for (let cur = g; cur !== s;) { const p = prev.get(cur)!; links.unshift(p.l); path.unshift(p.from); cur = p.from; }
  return {
    found: true, nodes: path, links: links.map(l => l.id),
    travelTimeS: Number(links.reduce((a, l) => a + l.t, 0).toFixed(1)), distanceM: Number(links.reduce((a, l) => a + l.dist, 0).toFixed(1)),
    usesStairs: links.some(l => l.stairs), usesElevator: links.some(l => l.elev),
    floors: [...new Set(path.map(n => nodes.get(n)!.floor_id))].sort(), appliedObstacles,
  };
}

/** SVG polyline points for one floor of a route (draw into <g id="route_layer">). */
export function routePointsForFloor(d: IndoorData, r: RouteResult, floorId: string): string {
  if (!r.found) return "";
  const nodes = new Map(d.nodes.map(n => [n.node_id, n]));
  return r.nodes.map(n => nodes.get(n)!).filter(n => n.floor_id === floorId).map(n => `${n.x},${n.y}`).join(" ");
}
