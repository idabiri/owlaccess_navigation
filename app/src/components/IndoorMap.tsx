import { useEffect, useMemo, useRef, useState } from "react";
import { buildIsoSvg } from "./isoView";
import { IsoFloorMap } from "./IsoFloorMap";
import type { UNode } from "../routing/unifiedRouting";
import type { ObstacleReport, ReportDraft } from "../reports/obstacleReports";

export interface IndoorMapProps {
  floor: number; svgText: string; nodes: Map<string, UNode>; routeNodeIds?: string[]; startRoomId?: string | null; goalRoomId?: string | null;
  activeObstacleIds?: string[]; onSelectRoom?: (roomId: string) => void;
  /** obstacle reporting: while reportMode is on, a click reports a point instead of choosing a room */
  reportMode?: boolean; onToggleReportMode?: () => void; onReportPoint?: (floorId: string, x: number, y: number) => void;
  reports?: ObstacleReport[]; draft?: ReportDraft | null; segmentOf?: (edgeId: string) => [number, number, number, number] | null;
  /** a report chosen with "Show on map": its marker pulses and is scrolled into view */
  focusReportId?: string | null;
  /** other route alternatives (node ids), drawn faintly under the selected route */
  altRouteNodeIds?: string[][];
  /** step-by-step navigation: the current step's stretch (highlighted), the SIMULATED position, and the route's ends */
  activeStepNodeIds?: string[]; positionNodeId?: string | null; endpointNodeIds?: { start: string; goal: string };
  /** how many floors the building has (the 3D view keeps the same camera and scale on every floor) */
  floorCount?: number;
}
const SVG_NS = "http://www.w3.org/2000/svg";
// stable empty defaults, so effects that depend on them don't re-run on every render
const NO_IDS: string[] = [], NO_ROUTES: string[][] = [], NO_REPORTS: ObstacleReport[] = [];
/** Point in the floor SVG's own units from a mouse event. Uses the SVG's screen transform where the browser has one. */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): [number, number] | null {
  const ctm = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (ctm && typeof svg.createSVGPoint === "function") { const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY; const q = p.matrixTransform(ctm.inverse()); return [q.x, q.y]; }
  const r = svg.getBoundingClientRect();                                            // fallback (test environment)
  const [vx, vy, vw, vh] = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (!r.width || !r.height || !vw || !vh) return null;
  return [vx + ((clientX - r.left) / r.width) * vw, vy + ((clientY - r.top) / r.height) * vh];
}
const ZOOMS = [1, 1.5, 2, 3];
type View = "iso" | "plan";
const VIEW_KEY = "owlaccess.indoor-view";
/** 3D (isometric) where the browser can show it; the flat 2D plan otherwise, or when the visitor chose it */
function initialView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === "iso" || v === "plan") return v; } catch { /* storage blocked */ }
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && typeof DOMParser !== "undefined" ? "iso" : "plan";
}
const same = (x: number, y: number): [number, number] => [x, y];
/** Renders ONE floor's SVG inline (element ids repeat across floors, so never mount two at once). SYNTHETIC / MOCK floor plan.
 *  Floors are switched by the map-view tabs in NavigationApp. */
export function IndoorMap({ floor, svgText, nodes, routeNodeIds = NO_IDS, startRoomId, goalRoomId, activeObstacleIds = NO_IDS, onSelectRoom,
  reportMode = false, onToggleReportMode, onReportPoint, reports = NO_REPORTS, draft = null, segmentOf, focusReportId = null, altRouteNodeIds = NO_ROUTES,
  activeStepNodeIds = NO_IDS, positionNodeId = null, endpointNodeIds, floorCount = 3 }: IndoorMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const floorId = `BLD001_F${floor}`;
  const [zoom, setZoom] = useState(0);                           // index into ZOOMS; kept when the floor changes
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* kept for this page only */ } };
  // the isometric drawing is built from this floor's SVG; routing coordinates are untouched (project / unproject are display-only)
  const iso = useMemo(() => {
    if (view !== "iso") return null;
    try { return buildIsoSvg(svgText, { floor, floorsBelow: floor - 1, maxBelow: Math.max(0, floorCount - 1) }); } catch { return null; }   // anything unexpected: the 2D plan
  }, [view, svgText, floor, floorCount]);
  const html = iso?.svg ?? svgText;
  const P = iso ? (x: number, y: number) => iso.project(x, y) : same;
  useEffect(() => {                                              // zoom: widen the plan and let its box scroll
    const svg = host.current?.querySelector("svg"); if (!svg) return;
    const z = ZOOMS[zoom];
    svg.style.width = `${z * 100}%`; svg.style.maxHeight = z > 1 ? "none" : "";
  }, [zoom, html]);
  useEffect(() => {                                              // route polyline, in the SVG's own coordinates
    const layer = host.current?.querySelector("#route_layer"); if (!layer) return;
    const xy = (n: UNode) => P(n.x as number, n.y as number).map(v => Math.round(v * 10) / 10);
    const ptsOf = (ids: string[]) => ids.map(id => nodes.get(id)).filter((n): n is UNode => !!n && n.floor_id === floorId).map(n => xy(n).join(",")).join(" ");
    const alts = altRouteNodeIds.map(ptsOf).filter(Boolean)
      .map(p => `<polyline points="${p}" stroke="#64748b" stroke-opacity=".55" stroke-width="3.5" stroke-dasharray="7 5" fill="none" stroke-linecap="round" stroke-linejoin="round" data-alt-route="true"/>`).join("");
    const pts = ptsOf(routeNodeIds), step = ptsOf(activeStepNodeIds);
    const here = (id: string | null | undefined) => { const n = id ? nodes.get(id) : null; return n && n.floor_id === floorId ? n : null; };
    const pin = (id: string | undefined, cls: string, label: string) => {
      const n = here(id); if (!n) return "";
      const [x, y] = xy(n);
      return `<g class="nav-pin ${cls}" data-pin="${cls}"><circle cx="${x}" cy="${y}" r="9"/><text x="${x}" y="${y - 14}" text-anchor="middle">${label}</text></g>`;
    };
    const meNode = here(positionNodeId), me = meNode ? (([x, y]) => ({ x, y }))(xy(meNode)) : null;
    layer.innerHTML = alts
      + (pts ? `<polyline class="nav-route-line${step ? " dim" : ""}" points="${pts}" stroke="#16a34a" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round" data-route="true"/>` : "")
      + (step ? `<polyline class="nav-step-line" points="${step}" stroke="#16a34a" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" data-active-step="true"/>` : "")
      + pin(endpointNodeIds?.start, "start", "Start") + pin(endpointNodeIds?.goal, "goal", "Destination")
      + (me ? `<g class="nav-me" data-position="simulated"><circle class="nav-me-ring" cx="${me.x}" cy="${me.y}" r="16"/><circle class="nav-me-dot" cx="${me.x}" cy="${me.y}" r="8"/>`
        + `<text x="${(me.x as number) + 14}" y="${(me.y as number) + 4}">You (simulated)</text><title>Simulated position for the selected step (demo): not your real location</title></g>` : "");
  }, [floorId, html, routeNodeIds, nodes, altRouteNodeIds, activeStepNodeIds, positionNodeId, endpointNodeIds]);
  useEffect(() => {                                              // a new step (or floor): bring the simulated position into view
    const marker = host.current?.querySelector<SVGElement>("#route_layer [data-position]");
    if (marker && typeof marker.scrollIntoView === "function") marker.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [positionNodeId, floorId]);
  useEffect(() => {                                              // obstacles: show only the active scenario's; mark start / destination rooms
    const root = host.current; if (!root) return;
    root.querySelectorAll<SVGElement>("[id^='obstacle_']").forEach(el => { el.style.display = activeObstacleIds.includes(el.id.replace("obstacle_", "")) ? "" : "none"; });
    root.querySelectorAll<SVGElement>("[id^='room_']").forEach(el => { el.removeAttribute("data-selected"); el.style.stroke = ""; el.style.strokeWidth = ""; });
    for (const [id, c] of [[startRoomId, "#2563eb"], [goalRoomId, "#dc2626"]] as const) {
      const el = id ? root.querySelector<SVGElement>(`#${id}`) : null; if (el) { el.setAttribute("data-selected", c === "#2563eb" ? "start" : "goal"); el.style.stroke = c; el.style.strokeWidth = "4"; }
    }
  }, [floorId, html, activeObstacleIds, startRoomId, goalRoomId]);
  useEffect(() => {                                              // pending reports (orange "?") and the draft being written (blue)
    const svg = host.current?.querySelector("svg"); if (!svg) return;
    let layer = svg.querySelector("#report_layer");
    if (!layer) { layer = document.createElementNS(SVG_NS, "g"); layer.id = "report_layer"; layer.setAttribute("pointer-events", "none"); svg.appendChild(layer); }
    layer.replaceChildren();
    const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text) e.textContent = text; layer!.appendChild(e); return e;
    };
    const mark = (x: number, y: number, edgeId: string, cls: string, label: string) => {
      const s = segmentOf?.(edgeId);
      if (s) { const [a, b] = P(s[0], s[1]), [c, d] = P(s[2], s[3]); el("line", { x1: a, y1: b, x2: c, y2: d, class: `report-seg ${cls}` }); }
      [x, y] = P(x, y);                                                              // reports keep plan coordinates; drawn where the plan point appears
      el("circle", { cx: x, cy: y, r: 11, class: `report-dot ${cls}` }); el("text", { x, y: y + 5, class: `report-q ${cls}`, "text-anchor": "middle" }, label);
    };
    const shown = reports.filter(r => r.floor_id === floorId && (r.status === "pending" || r.status === "verified"));   // rejected / resolved: history only
    for (const r of shown) mark(r.x, r.y, r.affected_edge_id, r.report_id === focusReportId ? `${r.status} focus` : r.status, r.status === "verified" ? "✕" : "?");
    if (draft && draft.floor_id === floorId) mark(draft.x, draft.y, draft.affected_edge_id, "draft", "!");
    layer.setAttribute("data-count", String(shown.length));
    const focused = layer.querySelector<SVGElement>(".report-dot.focus");                   // bring a "Show on map" report into view
    if (focused && typeof focused.scrollIntoView === "function") focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [floorId, html, reports, draft, segmentOf, focusReportId]);
  const click = (ev: React.MouseEvent) => {
    if (reportMode) {
      const svg = host.current?.querySelector("svg"); const q = svg ? svgPoint(svg, ev.clientX, ev.clientY) : null;
      const p = q && iso ? iso.unproject(q[0], q[1]) : q;                           // back to plan coordinates before snapping
      if (p) onReportPoint?.(floorId, p[0], p[1]);
      return;
    }
    const el = (ev.target as Element).closest("[id^='room_'], [id^='label_room_']"); if (!el) return;
    const id = el.id.replace("label_", ""); if (/^room_\d{3}$/.test(id)) onSelectRoom?.(id);
  };
  return (
    <div className="map-card" data-testid="indoor-map">
      <div className="map-tools" role="toolbar" aria-label="Floor plan zoom">
        <span className="view-switch" role="group" aria-label="Floor plan view">
          <button type="button" aria-pressed={view === "iso"} onClick={() => setView("iso")}>3D view</button>
          <button type="button" aria-pressed={view === "plan"} onClick={() => setView("plan")}>2D plan</button>
        </span>
        {!iso && <>
          <button type="button" onClick={() => setZoom(z => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in on floor plan">+</button>
          <button type="button" onClick={() => setZoom(z => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out of floor plan">-</button>
          <button type="button" onClick={() => setZoom(0)} disabled={zoom === 0}>Fit floor</button></>}
        {onToggleReportMode && <button type="button" className={reportMode ? "report-toggle on" : "report-toggle"} aria-pressed={reportMode} onClick={onToggleReportMode}>
          {reportMode ? "Cancel reporting" : "Report an obstacle"}</button>}
        <span className="current-floor" aria-live="polite">Current floor: <strong>{floor}</strong> &mdash; Academic Building (SYNTHETIC / MOCK interior)</span>
      </div>
      {iso
        ? <IsoFloorMap iso={iso} floor={floor} floorCount={Math.max(floorCount, floor)} nodes={nodes} routeNodeIds={routeNodeIds} altRouteNodeIds={altRouteNodeIds}
            activeStepNodeIds={activeStepNodeIds} positionNodeId={positionNodeId} endpointNodeIds={endpointNodeIds} startRoomId={startRoomId} goalRoomId={goalRoomId}
            activeObstacleIds={activeObstacleIds} onSelectRoom={onSelectRoom} reportMode={reportMode} onReportPoint={onReportPoint} reports={reports} draft={draft}
            segmentOf={segmentOf} focusReportId={focusReportId} />
        : <>
          <div ref={host} className={reportMode ? "indoor-svg reporting" : "indoor-svg"} onClick={click} data-view="plan" dangerouslySetInnerHTML={{ __html: svgText }} />
          <p className="map-note">Elevators (E1, E2) and stairwells are drawn on every floor. Click a room to choose it. Green line = route on this floor. Hatched red = demo obstacle of the active scenario. Orange <strong>?</strong> = pending user report (unverified, does not affect routes). Red <strong>✕</strong> = report verified by a reviewer (avoided by routes).</p>
        </>}
    </div>
  );
}
