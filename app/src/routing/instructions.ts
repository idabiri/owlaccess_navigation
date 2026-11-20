import type { RouteFound, UEdge, UNode, UnifiedData } from "./unifiedRouting";

export interface RouteSegment { index: number; kind: "outdoor" | "indoor"; floor_id: string | null; floor: number | null; nodeIds: string[]; firstNodeIndex: number; lastNodeIndex: number }
export interface Instruction {
  text: string; kind: "start" | "walk" | "turn-walk" | "enter" | "exit" | "elevator" | "stairs" | "ramp" | "arrive";
  segmentIndex: number; nodeIndex: number; nodeId: string; distanceM: number; timeS: number; warning?: string;
}
export interface NavigationPlan { segments: RouteSegment[]; instructions: Instruction[]; floorTransitions: { fromFloor: number; toFloor: number; via: "elevator" | "stairs"; text: string }[] }

export const floorNumber = (floorId: string | null) => (floorId ? Number(floorId.split("_F")[1]) : null);
const keyOf = (n: UNode) => (n.domain === "outdoor" ? "outdoor" : (n.floor_id as string));

function pos(n: UNode): [number, number] {                     // metres, x east / y north (indoor svg y points south)
  if (n.domain === "indoor") return [(n.x as number) / 10, -(n.y as number) / 10];
  return [((n.lon as number) + 84.52) * 92450, ((n.lat as number) - 33.938) * 110921];
}
const heading = (a: UNode, b: UNode) => { const [ax, ay] = pos(a), [bx, by] = pos(b); return (Math.atan2(bx - ax, by - ay) * 180) / Math.PI; };
const delta = (h1: number, h2: number) => { let d = h2 - h1; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; };
/** plain names for the Academic Building's (synthetic) doors, matching the place names in data.ts */
const ENTRANCE_NAME: Record<string, string> = {
  n_f1_entrance_1: "the northwest entrance", n_f1_entrance_2: "the Academic Building Entrance",
  n_f1_entrance_3: "the ramp entrance", n_f1_entrance_4: "the southwest entrance (steps)",
};
const turnWord = (d: number) => { const a = Math.abs(d), side = d > 0 ? "right" : "left"; return a < 35 ? "" : a < 75 ? `Slightly turn ${side}` : a < 135 ? `Turn ${side}` : `Turn sharply ${side}`; };

export function buildSegments(d: UnifiedData, r: RouteFound): RouteSegment[] {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n])), segs: RouteSegment[] = [];
  r.nodes.forEach((id, i) => {
    const n = nodes.get(id)!, k = keyOf(n), last = segs[segs.length - 1];
    if (!last || (last.kind === "outdoor" ? "outdoor" : (last.floor_id as string)) !== k) {
      segs.push({ index: segs.length, kind: n.domain, floor_id: n.floor_id, floor: floorNumber(n.floor_id), nodeIds: [id], firstNodeIndex: i, lastNodeIndex: i });
    } else { last.nodeIds.push(id); last.lastNodeIndex = i; }
  });
  return segs;
}

export function buildPlan(d: UnifiedData, r: RouteFound, startLabel?: string, goalLabel?: string): NavigationPlan {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n])), edges = new Map(d.edges.map(e => [e.edge_id, e]));
  const segments = buildSegments(d, r);
  const segOf = (i: number) => segments.find(s => i >= s.firstNodeIndex && i <= s.lastNodeIndex)!.index;
  const ins: Instruction[] = [], trans: NavigationPlan["floorTransitions"] = [];
  const push = (text: string, kind: Instruction["kind"], nodeIndex: number, distanceM = 0, timeS = 0, warning?: string) =>
    ins.push({ text, kind, segmentIndex: segOf(nodeIndex), nodeIndex, nodeId: r.nodes[nodeIndex], distanceM: Math.round(distanceM * 10) / 10, timeS: Math.round(timeS * 10) / 10, warning });
  push(`Start at ${startLabel ?? r.nodes[0]}.`, "start", 0);

  let leg: { from: number; to: number; dist: number; time: number; h: number } | null = null, prevHeading: number | null = null;
  const flushLeg = () => {
    if (!leg) return;
    const m = Math.max(1, Math.round(leg.dist)), t = prevHeading === null ? "" : turnWord(delta(prevHeading, leg.h));
    push(`${t ? t + " and walk" : "Walk"} ${m} m.`, t ? "turn-walk" : "walk", leg.from, leg.dist, leg.time);
    prevHeading = leg.h; leg = null;
  };
  for (let i = 0; i < r.links.length; i++) {
    const e = edges.get(r.links[i]) as UEdge, a = nodes.get(r.nodes[i]) as UNode, b = nodes.get(r.nodes[i + 1]) as UNode;
    const special = e.vertical || e.edge_type === "building_connector" || e.edge_type === "steps" || e.edge_type === "entrance_steps" || e.edge_type === "ramp";
    if (!special) {
      if (e.distance < 0.05) continue;
      const h = heading(a, b);
      if (leg && Math.abs(delta(leg.h, h)) < 35) { leg.dist += e.distance; leg.time += e.travel_time; leg.to = i + 1; leg.h = h; }
      else { flushLeg(); leg = { from: i, to: i + 1, dist: e.distance, time: e.travel_time, h }; }
      continue;
    }
    flushLeg();
    if (e.vertical) {
      const fa = floorNumber(a.floor_id) as number, fb = floorNumber(b.floor_id) as number, num = a.node_id.split("_").pop();
      if (e.edge_type === "elevator") { const text = `Take elevator ${num} from floor ${fa} to floor ${fb}.`; push(text, "elevator", i, e.distance, e.travel_time); trans.push({ fromFloor: fa, toFloor: fb, via: "elevator", text }); }
      else { const text = `Take stairwell ${num} from floor ${fa} to floor ${fb} (stairs).`; push(text, "stairs", i, e.distance, e.travel_time, "Stairs: not usable in wheelchair mode"); trans.push({ fromFloor: fa, toFloor: fb, via: "stairs", text }); }
      prevHeading = null;
    } else if (e.edge_type === "building_connector") {
      const entering = a.domain === "outdoor"; const ent = entering ? b : a;
      const door = ENTRANCE_NAME[ent.node_id] ?? ent.node_id.split("_").slice(-2).join(" ");
      push(entering ? `Enter the Academic Building through ${door} (location not yet field-checked).` : `Leave the Academic Building through ${door} (location not yet field-checked).`, entering ? "enter" : "exit", i, e.distance, e.travel_time, "Entrance location and accessibility are not field-verified");
      prevHeading = null;
    } else if (e.edge_type === "ramp") {
      push(`Use the ramp (${Math.round(e.distance)} m; slope not modeled).`, "ramp", i, e.distance, e.travel_time, "Ramp slope unknown"); prevHeading = null;
    } else {
      push(`Take the steps (${Math.round(e.distance)} m).`, "stairs", i, e.distance, e.travel_time, "Steps: not usable in wheelchair mode"); prevHeading = null;
    }
  }
  flushLeg();
  push(`Arrive at ${goalLabel ?? r.nodes[r.nodes.length - 1]}.`, "arrive", r.nodes.length - 1);
  return { segments, instructions: ins, floorTransitions: trans };
}
