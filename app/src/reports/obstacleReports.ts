// User obstacle reports. A report is ALWAYS created as pending and unverified (Stage 2).
// Only a person acting as reviewer can verify it (Stage 4); only verified reports can ever block a route, and only
// through blockingObstacles() below. Severity decides who is blocked: everyone, wheelchair routes only, or nobody (minor).
import type { UnifiedData, UObstacle, UEdge } from "../routing/unifiedRouting";
import { SEVERITIES, type Severity, type Suggestion } from "./classify";

export const REPORT_CATEGORIES = {
  blocked_hallway: "Blocked hallway",
  blocked_doorway: "Blocked doorway",
  elevator_unavailable: "Elevator not working",
  construction_area: "Construction area",
  other: "Other",
} as const;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;

export interface ObstacleReport {
  report_id: string;
  created_at: string;                 // ISO time
  floor_id: string;                   // e.g. BLD001_F1
  x: number; y: number;               // where it was tapped, in the floor SVG's units (10 units = 1 m)
  affected_edge_id: string;           // nearest walkable segment on that floor
  snap_distance_m: number;
  location_label: string;
  category: ReportCategory;           // chosen by the person (possibly by accepting the suggestion)
  severity?: Severity;                // chosen by the person
  description: string;
  suggestion?: Suggestion;            // what the rule-based classifier suggested, kept for the reviewer. Advisory only.
  suggestion_accepted?: boolean;      // true when the person's category and severity equal the suggestion
  status: ReportStatus;               // starts as "pending", whatever the suggestion says
  verified: boolean;                  // true only after a reviewer verified it (status verified, or later resolved)
  source: "user_report";
  review?: Review;                    // the reviewer's decision; required for every status except pending
}
export type ReportStatus = "pending" | "verified" | "rejected" | "resolved";
/** Severities a reviewer may confirm (a reviewer must decide: "not sure" is not allowed) */
export type ConfirmedSeverity = Exclude<Severity, "unclear">;
export interface Review {
  decision: "verified" | "rejected"; reviewed_at: string; reviewer: "demo reviewer (no sign-in)"; note: string;
  category: ReportCategory; severity: ConfirmedSeverity;   // what the reviewer confirmed; authoritative over the reporter's choice
  resolved_at?: string; resolved_note?: string;
}
export interface ReportDraft { floor_id: string; x: number; y: number; affected_edge_id: string; edge_type?: string; snap_distance_m: number; location_label: string; chosen_from_list?: boolean }

export const MAX_SNAP_M = 3;          // a tap further than this from any walkable segment is not accepted
export const MAX_DESCRIPTION = 300;
const UNITS_PER_M = 10;

/** Distance from point p to segment ab, in SVG units. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function describeEdge(d: UnifiedData, e: UEdge): string {
  const kind = e.edge_type.replace(/_/g, " ");
  const space = e.space_id ? d.endpoints_meta.find(m => m.id === e.space_id)?.label ?? e.space_id.replace(/^hallway_(\d+)$/, "Hallway $1") : null;
  if (space && e.edge_type === "hallway" && space.startsWith("Hallway ")) return space;   // "Hallway 5", not "hallway – Hallway 5"
  return space ? `${kind} – ${space}` : kind;
}

/** Snap a tapped point to the nearest walkable, same-floor indoor segment. Returns null if nothing is within MAX_SNAP_M. */
export function snapToEdge(d: UnifiedData, floorId: string, x: number, y: number): ReportDraft | null {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n]));
  let best: { e: UEdge; dist: number } | null = null;
  for (const e of d.edges) {
    if (e.domain !== "indoor" || e.vertical || e.floor_id !== floorId) continue;
    const a = nodes.get(e.from_node), b = nodes.get(e.to_node);
    if (a?.x == null || a.y == null || b?.x == null || b.y == null) continue;
    const dist = segDist(x, y, a.x, a.y, b.x, b.y);
    if (!best || dist < best.dist || (dist === best.dist && e.edge_id < best.e.edge_id)) best = { e, dist };
  }
  if (!best || best.dist / UNITS_PER_M > MAX_SNAP_M) return null;
  return { floor_id: floorId, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, affected_edge_id: best.e.edge_id, edge_type: best.e.edge_type,
    snap_distance_m: Math.round((best.dist / UNITS_PER_M) * 10) / 10, location_label: describeEdge(d, best.e) };
}

// ---- choosing a location without a pointer (Stage 7): every reportable segment on a floor, named in words ----
export interface ReportPlace { edge_id: string; group: "Hallways" | "Doorways" | "Elevators" | "Entrances and ramps" | "Stairwells"; label: string }
const PLACE_GROUP: Record<string, ReportPlace["group"]> = {
  hallway: "Hallways", door: "Doorways", elevator_door: "Elevators", entrance_threshold: "Entrances and ramps", ramp: "Entrances and ramps",
  entrance_steps: "Entrances and ramps", stair_landing: "Stairwells",
};
const GROUP_ORDER: ReportPlace["group"][] = ["Hallways", "Doorways", "Elevators", "Entrances and ramps", "Stairwells"];

/** Every segment of a floor that a report can be placed on, with a name a person can pick from a list. */
export function listReportPlaces(d: UnifiedData, floorId: string): ReportPlace[] {
  const nodes = new Map(d.nodes.map(n => [n.node_id, n]));
  const label = (id: string | null | undefined) => (id ? d.endpoints_meta.find(m => m.id === id)?.label ?? id : null);
  const nodeName = (id: string): string => {
    const n = nodes.get(id); const wp = id.match(/_wp_(\d{3})$/);
    if (wp) return `outside ${label(`room_${wp[1]}`)}`;
    if (/_entrance_(\d+)$/.test(id)) return `entrance ${id.split("_").pop()}`;
    if (/_elev_(\d+)$/.test(id)) return `elevator ${id.split("_").pop()}`;
    if (n?.node_type === "hallway_intersection") return `junction ${id.split("_").pop()}`;
    if (n?.node_type === "ramp") return "the ramp";
    if (n?.room_id) return `in ${label(n.room_id)}`;
    return "corridor end";
  };
  const places: ReportPlace[] = [];
  for (const e of d.edges) {
    if (e.domain !== "indoor" || e.vertical || e.floor_id !== floorId) continue;
    const group = PLACE_GROUP[e.edge_type]; if (!group) continue;          // room interiors are not offered: report at the doorway
    let text: string;
    if (e.edge_type === "hallway") text = `${describeEdge(d, e)}: ${nodeName(e.from_node)} – ${nodeName(e.to_node)}`;
    else if (e.edge_type === "door") text = `Doorway of ${label(e.space_id)}`;
    else if (e.edge_type === "elevator_door") text = `${nodeName([e.from_node, e.to_node].find(x => /_elev_/.test(x)) ?? e.to_node).replace(/^e/, "E")} door (${label(e.space_id)})`;
    else if (e.edge_type === "stair_landing") text = `Stairs landing in ${label(e.space_id)}`;
    else if (e.edge_type === "ramp") text = "Ramp inside the east entrance";
    else { const ent = [e.from_node, e.to_node].find(x => /_entrance_/.test(x)); text = `${ent ? nodeName(ent).replace(/^e/, "E") : "Entrance"}${e.edge_type === "entrance_steps" ? " (steps)" : ""} threshold`; }
    places.push({ edge_id: e.edge_id, group, label: text });
  }
  return places.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}
/** A draft for a place chosen from the list: placed at the middle of its segment. */
export function draftFromPlace(d: UnifiedData, floorId: string, edgeId: string): ReportDraft | null {
  const place = listReportPlaces(d, floorId).find(p => p.edge_id === edgeId), e = d.edges.find(x => x.edge_id === edgeId);
  const a = e && d.nodes.find(n => n.node_id === e.from_node), b = e && d.nodes.find(n => n.node_id === e.to_node);
  if (!place || !e || a?.x == null || a.y == null || b?.x == null || b.y == null) return null;
  return { floor_id: floorId, x: Math.round(((a.x + b.x) / 2) * 10) / 10, y: Math.round(((a.y + b.y) / 2) * 10) / 10,
    affected_edge_id: edgeId, edge_type: e.edge_type, snap_distance_m: 0, location_label: place.label, chosen_from_list: true };
}

export function createReport(draft: ReportDraft, category: ReportCategory, description: string,
  extra: { severity?: Severity; suggestion?: Suggestion; now?: Date } = {}): ObstacleReport {
  const text = description.trim().slice(0, MAX_DESCRIPTION);
  if (!text) throw new Error("A description is required.");
  const now = extra.now ?? new Date(), s = extra.suggestion;
  return { report_id: `RPT-${now.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    created_at: now.toISOString(), ...draft, category, severity: extra.severity, description: text,
    ...(s ? { suggestion: s, suggestion_accepted: s.category === category && s.severity === extra.severity } : {}),
    status: "pending", verified: false, source: "user_report" };   // set last: nothing above can override them
}

/** The obstacle a report is for the router. Only status "verified" with verified=true ever blocks (the router's own rule). */
export function reportToObstacle(r: ObstacleReport): UObstacle {
  const status = r.status === "verified" ? "verified" : r.status === "resolved" ? "resolved" : "pending";   // rejected -> never blocks
  return { obstacle_id: r.report_id, status, verified: r.status === "verified" && r.verified === true, affected_edge_id: r.affected_edge_id,
    obstacle_type: r.review?.category ?? r.category, floor_id: r.floor_id,
    description: `USER REPORT (${r.status === "verified" ? "verified by reviewer" : "not verified"}) - ${r.description}` };
}

// ---- human review (Stage 4) ----
const nowIso = (now?: Date) => (now ?? new Date()).toISOString();
export const SEVERITY_FOR_REVIEW: ConfirmedSeverity[] = ["blocks_everyone", "blocks_wheelchair", "minor"];

export function verifyReport(r: ObstacleReport, category: ReportCategory, severity: ConfirmedSeverity, note = "", now?: Date): ObstacleReport {
  if (r.status !== "pending") throw new Error(`Only a pending report can be verified (this one is ${r.status}).`);
  if (!SEVERITY_FOR_REVIEW.includes(severity)) throw new Error("The reviewer must choose a severity.");
  return { ...r, status: "verified", verified: true,
    review: { decision: "verified", reviewed_at: nowIso(now), reviewer: "demo reviewer (no sign-in)", note: note.trim().slice(0, MAX_DESCRIPTION), category, severity } };
}
export function rejectReport(r: ObstacleReport, note = "", now?: Date): ObstacleReport {
  if (r.status !== "pending") throw new Error(`Only a pending report can be rejected (this one is ${r.status}).`);
  return { ...r, status: "rejected", verified: false,
    review: { decision: "rejected", reviewed_at: nowIso(now), reviewer: "demo reviewer (no sign-in)", note: note.trim().slice(0, MAX_DESCRIPTION),
      category: r.category, severity: r.severity && r.severity !== "unclear" ? r.severity : "minor" } };
}
/** The obstacle has been cleared: it stays in the history but no longer blocks. */
export function resolveReport(r: ObstacleReport, note = "", now?: Date): ObstacleReport {
  if (r.status !== "verified" || !r.review) throw new Error(`Only a verified report can be resolved (this one is ${r.status}).`);
  return { ...r, status: "resolved", review: { ...r.review, resolved_at: nowIso(now), resolved_note: note.trim().slice(0, MAX_DESCRIPTION) } };
}

/** Does this report block a route in this mode? Verified + "blocks everyone" always; "blocks wheelchair users" only in wheelchair mode; minor never. */
export function reportBlocks(r: ObstacleReport, wheelchair: boolean): boolean {
  if (r.status !== "verified" || r.verified !== true || !r.review || r.review.decision !== "verified") return false;
  return r.review.severity === "blocks_everyone" || (r.review.severity === "blocks_wheelchair" && wheelchair);
}
/** The verified reports to hand to the router for this mode, as router obstacles. Everything else is left out. */
export function blockingObstacles(reports: ObstacleReport[], wheelchair: boolean): UObstacle[] {
  return reports.filter(r => reportBlocks(r, wheelchair)).map(reportToObstacle);
}

// ---- browser storage (this browser only). Every access is guarded: storage can be missing or blocked. ----
export const STORAGE_KEY = "ksu-nav.obstacle-reports.v1";

/** Is this a well-formed, internally consistent report? Used for browser storage AND by the dev-server reports API. */
export function isReport(v: unknown): v is ObstacleReport {
  const r = v as ObstacleReport;
  if (!(!!r && typeof r.report_id === "string" && typeof r.floor_id === "string" && typeof r.affected_edge_id === "string"
    && typeof r.x === "number" && typeof r.y === "number" && typeof r.description === "string" && r.category in REPORT_CATEGORIES
    && (r.severity === undefined || r.severity in SEVERITIES))) return false;
  // status, verified flag and review must agree; anything inconsistent is dropped rather than trusted
  const rv = r.review, reviewOk = !!rv && typeof rv.reviewed_at === "string" && rv.category in REPORT_CATEGORIES && SEVERITY_FOR_REVIEW.includes(rv.severity);
  switch (r.status) {
    case "pending": return r.verified === false && rv === undefined;
    case "verified": return r.verified === true && reviewOk && rv!.decision === "verified" && !rv!.resolved_at;
    case "resolved": return r.verified === true && reviewOk && rv!.decision === "verified" && typeof rv!.resolved_at === "string";
    case "rejected": return r.verified === false && reviewOk && rv!.decision === "rejected";
    default: return false;
  }
}
/** A stored suggestion is display-only; keep it only if it is well-formed. */
export function cleanSuggestion(r: ObstacleReport): ObstacleReport {
  const s = r.suggestion as Suggestion | undefined;
  const ok = !!s && s.method === "rule-based" && s.category in REPORT_CATEGORIES && s.severity in SEVERITIES && Array.isArray(s.matched);
  if (ok) return r;
  const { suggestion: _drop, suggestion_accepted: _drop2, ...rest } = r; return rest;
}
export function loadReports(storage: Pick<Storage, "getItem"> | null = safeStorage()): ObstacleReport[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY); if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isReport).map(cleanSuggestion) : [];   // anything malformed or inconsistent is dropped, never trusted
  } catch { return []; }
}
export function saveReports(reports: ObstacleReport[], storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(reports)); return !!storage; } catch { return false; }
}
function safeStorage(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
