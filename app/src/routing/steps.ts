// Navigation steps for the step-by-step view. Built ONLY from the existing route (nodes, links) and the existing
// turn-by-turn instructions (buildPlan): nothing is invented. Each step covers the route from its instruction's node to
// the next instruction's node, so the steps together cover the whole route, in order, with no gaps.
import type { RouteFound, UnifiedData, UEdge } from "./unifiedRouting";
import type { NavigationPlan, Instruction } from "./instructions";

export interface NavStep {
  index: number; ins: Instruction;
  /** route node indexes this step covers (inclusive) and their ids */
  fromNodeIndex: number; toNodeIndex: number; nodeIds: string[];
  /** where the (simulated) position marker sits while this step is current: where the step starts */
  positionNodeId: string;
  /** "Outdoors" or "Floor N" */
  place: string; floor: number | null;
  /** route distance before this step starts, from the route's own edges */
  distanceBeforeM: number;
  /** step-free transitions (elevator, ramp) are marked so; stairs never appear in wheelchair routes (routing excludes them) */
  stepFree: boolean;
  warnings: string[];
}

export function buildSteps(d: UnifiedData, r: RouteFound, plan: NavigationPlan): NavStep[] {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n])), edges = new Map(d.edges.map(e => [e.edge_id, e]));
  const linkEdges: UEdge[] = r.links.map(id => edges.get(id)!);
  const ins = plan.instructions, last = r.nodes.length - 1;
  let outdoorWarned = false;
  return ins.map((s, i) => {
    const from = s.nodeIndex, to = i + 1 < ins.length ? Math.max(from, ins[i + 1].nodeIndex) : last;
    const span = linkEdges.slice(from, to);                             // the route's own edges inside this step
    const n = nodes.get(r.nodes[from])!;
    const warnings: string[] = [];
    if (s.warning) warnings.push(s.warning);
    if (s.kind === "elevator") warnings.push("Elevator availability is not verified");
    const narrow = span.filter(e => e.potentially_narrow).length;
    if (narrow) warnings.push(`Potentially narrow corridor (${narrow} segment${narrow > 1 ? "s" : ""}, synthetic flag)`);
    if (!outdoorWarned && span.some(e => e.domain === "outdoor" && e.edge_type !== "steps")) { warnings.push("Outdoor surface and slope are unknown"); outdoorWarned = true; }
    return {
      index: i, ins: s, fromNodeIndex: from, toNodeIndex: to, nodeIds: r.nodes.slice(from, to + 1), positionNodeId: r.nodes[from],
      place: n.domain === "outdoor" ? "Outdoors" : `Floor ${n.floor_id?.split("_F")[1]}`, floor: n.domain === "outdoor" ? null : Number(n.floor_id?.split("_F")[1]),
      distanceBeforeM: Math.round(linkEdges.slice(0, from).reduce((t, e) => t + e.distance, 0) * 10) / 10,
      stepFree: s.kind === "elevator" || s.kind === "ramp",
      warnings: [...new Set(warnings)],
    };
  });
}
