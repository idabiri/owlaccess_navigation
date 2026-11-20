// The 3D (isometric) indoor map: the static model from isoView.ts plus everything a person navigating needs on top of it,
// drawn upright and at a constant on-screen size whatever the zoom:
//   route (done / current step / still to go), the simulated position, start and destination, floor changes,
//   demo obstacles and reports, and room / feature labels that never overlap each other, the route or the markers.
// Camera: buttons, Ctrl/Cmd + scroll, drag to pan, two-finger pinch on touch screens, keyboard (arrows, + / -, 0).
// Display only: routing coordinates are projected for drawing and taps are projected back; nothing in the data changes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UNode } from "../routing/unifiedRouting";
import type { ObstacleReport, ReportDraft } from "../reports/obstacleReports";
import { ISO, type IsoResult, type IsoRoom } from "./isoView";

export interface IsoFloorMapProps {
  iso: IsoResult; floor: number; floorCount: number; nodes: Map<string, UNode>;
  routeNodeIds: string[]; altRouteNodeIds: string[][]; activeStepNodeIds: string[]; positionNodeId: string | null; endpointNodeIds?: { start: string; goal: string };
  startRoomId?: string | null; goalRoomId?: string | null; activeObstacleIds: string[]; onSelectRoom?: (roomId: string) => void;
  reportMode: boolean; onReportPoint?: (floorId: string, x: number, y: number) => void;
  reports: ObstacleReport[]; draft: ReportDraft | null; segmentOf?: (edgeId: string) => [number, number, number, number] | null; focusReportId: string | null;
}
type Cam = { x: number; y: number; w: number; h: number };
type Box = [number, number, number, number];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const overlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const ROOM_KIND: Record<string, string> = { wc: "Restroom", lobby: "Lobby", stair: "Stairwell", service: "Service room", office: "Office", learn: "Room" };

/** point in SVG user units (current viewBox) from a pointer position */
function toSvg(svg: SVGSVGElement, clientX: number, clientY: number): [number, number] | null {
  const ctm = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (ctm && typeof svg.createSVGPoint === "function") { const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY; const q = p.matrixTransform(ctm.inverse()); return [q.x, q.y]; }
  const r = svg.getBoundingClientRect(); const [vx, vy, vw, vh] = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (!r.width || !r.height || !vw || !vh) return null;
  return [vx + ((clientX - r.left) / r.width) * vw, vy + ((clientY - r.top) / r.height) * vh];
}

export function IsoFloorMap(p: IsoFloorMapProps) {
  const { iso, floor, floorCount, nodes } = p;
  const floorId = `BLD001_F${floor}`;
  const W = iso.width, H = iso.height, fit: Cam = useMemo(() => ({ x: 0, y: 0, w: W, h: H }), [W, H]);
  const [cam, setCam] = useState<Cam>(fit);
  const [cw, setCw] = useState(0);                               // drawn width of the map in CSS px
  const [info, setInfo] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const svgEl = () => host.current?.querySelector("svg") as SVGSVGElement | null;
  const px = (cw || 560) / cam.w;                                // CSS px per SVG unit at the current zoom
  const u = 1 / px;                                              // SVG units per CSS px: overlays are authored in px and scaled by u
  const zoomLevel = W / cam.w;

  // ---- camera ----
  const clamp = useCallback((c: Cam): Cam => {
    const w = Math.min(W, Math.max(W / 7, c.w)), h = w * H / W;
    if (w >= W - 0.01) return { x: 0, y: 0, w: W, h: H };
    return { w, h, x: Math.min(W - w * 0.35, Math.max(-w * 0.65, c.x)), y: Math.min(H - h * 0.35, Math.max(-h * 0.65, c.y)) };
  }, [W, H]);
  const zoomAt = useCallback((factor: number, fx?: number, fy?: number) => setCam(c => {
    const nx = fx ?? c.x + c.w / 2, ny = fy ?? c.y + c.h / 2, w = c.w / factor;
    return clamp({ w, h: w * H / W, x: nx - (nx - c.x) * (w / c.w), y: ny - (ny - c.y) * (w / c.w) });
  }), [clamp, W, H]);
  const centerOn = useCallback((X: number, Y: number, minZoom = 1) => setCam(c => {
    const w = Math.min(c.w, W / minZoom), h = w * H / W; return clamp({ w, h, x: X - w / 2, y: Y - h / 2 });
  }), [clamp, W, H]);
  useLayoutEffect(() => { svgEl()?.setAttribute("viewBox", `${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.w.toFixed(1)} ${cam.h.toFixed(1)}`); });
  useEffect(() => {                                              // track the map's drawn width (labels and markers keep a constant size)
    const el = stage.current; if (!el) return;
    const read = () => setCw(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {                                              // Ctrl/Cmd + scroll (and trackpad pinch) zooms at the pointer; plain scroll scrolls the page
    const el = stage.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); const svg = svgEl(); const q = svg ? toSvg(svg, e.clientX, e.clientY) : null;
      zoomAt(Math.exp(-e.deltaY * 0.0025), q?.[0], q?.[1]);
    };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // drag to pan, pinch to zoom; a tap (no drag) still selects or reports
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ cam: Cam; x: number; y: number; dist: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    const mid = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
    gesture.current = { cam, x: mid.x, y: mid.y, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !gesture.current) {
      const t = (e.target as Element).closest?.("[data-room], [id^='room_'], [data-feature]");      // hover: say what is under the pointer
      if (e.pointerType === "mouse") setInfo(t ? describe(t) : null);
      return;
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current, pts = [...ptrs.current.values()];
    const mid = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
    const dx = mid.x - g.x, dy = mid.y - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 5 && pts.length < 2) return;
    if (!g.moved) { g.moved = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
    const k = g.cam.w / (cw || 560);
    let next: Cam = { ...g.cam, x: g.cam.x - dx * k, y: g.cam.y - dy * k };
    if (pts.length > 1 && g.dist > 0) {
      const f = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist, w = g.cam.w / f;
      const r = host.current!.getBoundingClientRect(), fx = g.cam.x + (g.x - r.left) * k, fy = g.cam.y + (g.y - r.top) * k;
      next = { w, h: w * H / W, x: fx - (fx - g.cam.x) * (w / g.cam.w) - dx * k, y: fy - (fy - g.cam.y) * (w / g.cam.w) - dy * k };
    }
    setCam(clamp(next));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (gesture.current?.moved) suppressClick.current = true;
    if (ptrs.current.size === 0) gesture.current = null; else { const q = [...ptrs.current.values()][0]; gesture.current = { cam, x: q.x, y: q.y, dist: 0, moved: true }; }
  };

  // ---- what a room or feature is, in words ----
  const roomById = useMemo(() => new Map(iso.rooms.map(r => [r.id, r])), [iso.rooms]);
  const describe = useCallback((el: Element): string => {
    const fid = el.getAttribute("data-feature");
    if (fid) { const f = iso.features.find(x => x.id === fid); return f ? `${f.label} · ${f.detail} · Floor ${floor}` : ""; }
    const id = el.getAttribute("data-room") ?? el.id; const r = roomById.get(id); if (!r) return "";
    const tone = (el.ownerDocument.getElementById(id)?.getAttribute("data-tone")) ?? "learn";
    const kind = tone === "learn" ? "" : ` · ${ROOM_KIND[tone] ?? ""}`;
    return `${r.name} · Room ${r.number} · Floor ${floor}${kind}${r.accessible ? " · marked step-free (synthetic, not field-checked)" : ""}${p.onSelectRoom ? " · click to choose it" : ""}`;
  }, [iso.features, roomById, floor, p.onSelectRoom]);

  const click = (ev: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const svg = svgEl(); if (!svg) return;
    if (p.reportMode) {
      const q = toSvg(svg, ev.clientX, ev.clientY); if (!q) return;
      const [x, y] = iso.unproject(q[0], q[1]); p.onReportPoint?.(floorId, x, y); return;
    }
    const t = (ev.target as Element).closest("[data-room], [id^='room_'], [data-feature]"); if (!t) return;
    setInfo(describe(t));
    const id = t.getAttribute("data-room") ?? t.id;
    if (/^room_[A-Za-z0-9]+$/.test(id)) p.onSelectRoom?.(id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = cam.w * 0.15;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] };
    if (moves[e.key]) { e.preventDefault(); setCam(c => clamp({ ...c, x: c.x + moves[e.key][0], y: c.y + moves[e.key][1] })); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(1.4); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(1 / 1.4); }
    else if (e.key === "0") { e.preventDefault(); setCam(fit); }
  };

  // ---- where things are on screen ----
  const here = useCallback((id: string | null | undefined) => { const n = id ? nodes.get(id) : null; return n && n.floor_id === floorId ? n : null; }, [nodes, floorId]);
  const at = useCallback((n: UNode, z = 0) => iso.project(n.x as number, n.y as number, z), [iso]);
  const me = here(p.positionNodeId);
  const meXY = me ? at(me) : null;

  useEffect(() => {                                              // a new step: keep the simulated position in view (without changing the zoom)
    if (!meXY) return;
    setCam(c => {
      const [X, Y] = meXY, mx = c.w * 0.12, my = c.h * 0.12;
      return X < c.x + mx || X > c.x + c.w - mx || Y < c.y + my || Y > c.y + c.h - my ? clamp({ ...c, x: X - c.w / 2, y: Y - c.h / 2 }) : c;
    });
  }, [p.positionNodeId, floorId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                              // "Show on map" for a report: bring it into view
    const r = p.reports.find(x => x.report_id === p.focusReportId && x.floor_id === floorId); if (!r) return;
    const [X, Y] = iso.project(r.x, r.y); centerOn(X, Y, 1.6);
  }, [p.focusReportId, floorId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- floor shapes: demo obstacles of the active scenario, selected rooms ----
  useLayoutEffect(() => {
    const root = host.current; if (!root) return;
    root.querySelectorAll<SVGElement>("[id^='obstacle_']").forEach(el => { el.style.display = p.activeObstacleIds.includes(el.id.replace("obstacle_", "")) ? "" : "none"; });
    root.querySelectorAll<SVGElement>("#layer_rooms [id^='room_']").forEach(el => el.removeAttribute("data-selected"));
    for (const [id, v] of [[p.startRoomId, "start"], [p.goalRoomId, "goal"]] as const) { const el = id ? root.querySelector(`#${id}`) : null; el?.setAttribute("data-selected", v); }
  }, [iso.svg, p.activeObstacleIds, p.startRoomId, p.goalRoomId]);

  // ---- overlays: route, markers, transitions, obstacles, reports, labels ----
  useLayoutEffect(() => {
    const svg = svgEl(); if (!svg) return;
    const xyStr = (q: [number, number]) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
    const reserved: Box[] = [];
    const reserve = (X: number, Y: number, wPx: number, hPx: number, dyPx = 0) => reserved.push([X - wPx / 2 * u, Y + (dyPx - hPx / 2) * u, X + wPx / 2 * u, Y + (dyPx + hPx / 2) * u]);
    const g = (X: number, Y: number, inner: string, cls: string, extra = "") => `<g class="${cls}" transform="translate(${X.toFixed(1)} ${Y.toFixed(1)}) scale(${u.toFixed(4)})"${extra}>${inner}</g>`;
    const chip = (text: string, cls: string, dy = 0, anchor: "middle" | "start" = "middle") => {
      const w = text.length * 6.6 + 16, x0 = anchor === "middle" ? -w / 2 : 0;
      return `<g class="chip ${cls}"><rect x="${x0}" y="${dy - 11}" width="${w}" height="22" rx="11"/><text x="${x0 + w / 2}" y="${dy + 4}" text-anchor="middle">${esc(text)}</text></g>`;
    };

    // route on this floor, split into done / current step / still to go
    const ids = p.routeNodeIds, stepIds = p.activeStepNodeIds;
    const i0 = stepIds.length ? ids.indexOf(stepIds[0]) : -1, i1 = stepIds.length ? ids.lastIndexOf(stepIds[stepIds.length - 1]) : -1;
    const runs = (from: number, to: number) => {                  // consecutive on-floor stretches between two route indices
      const out: string[] = []; let cur: string[] = [];
      for (let k = Math.max(0, from); k <= Math.min(ids.length - 1, to); k++) { const n = here(ids[k]); if (n) cur.push(xyStr(at(n))); else { if (cur.length > 1) out.push(cur.join(" ")); cur = []; } }
      if (cur.length > 1) out.push(cur.join(" ")); return out;
    };
    const line = (pts: string, cls: string) => `<polyline class="${cls}" points="${pts}"/>`;
    let route = "";
    for (const alt of p.altRouteNodeIds) { const a = alt.map(id => here(id)).filter((n): n is UNode => !!n).map(n => xyStr(at(n))); if (a.length > 1) route += line(a.join(" "), "r-alt") ; }
    const all = runs(0, ids.length - 1);
    all.forEach(s => { route += `<polyline class="r-casing" data-route="true" points="${s}"/>`; });
    if (i0 >= 0 && i1 >= i0) {
      runs(0, i0).forEach(s => { route += line(s, "r-done"); });
      runs(i1, ids.length - 1).forEach(s => { route += line(s, "r-next"); });
      runs(i0, i1).forEach(s => { route += line(s, "r-cur-casing") + `<polyline class="r-cur" data-active-step="true" points="${s}"/>`; });
      // direction arrows along the current step
      for (let k = i0; k < i1; k++) {
        const a = here(ids[k]), b = here(ids[k + 1]); if (!a || !b) continue;
        const A = at(a), B = at(b), len = Math.hypot(B[0] - A[0], B[1] - A[1]) * px; if (len < 46) continue;
        const ang = Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI;
        route += `<g class="r-arrow" transform="translate(${((A[0] + B[0]) / 2).toFixed(1)} ${((A[1] + B[1]) / 2).toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${u.toFixed(4)})"><path d="M-4 -5 L3 0 L-4 5"/></g>`;
      }
    } else all.forEach(s => { route += line(s, "r-next"); });
    // keep labels off the route
    for (const id of ids) { const n = here(id); if (n) { const [X, Y] = at(n); reserve(X, Y, 18, 18); } }
    for (let k = 0; k < ids.length - 1; k++) {
      const a = here(ids[k]), b = here(ids[k + 1]); if (!a || !b) continue; const A = at(a), B = at(b), steps = Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) * px / 14);
      for (let s = 1; s < steps; s++) reserve(A[0] + (B[0] - A[0]) * s / steps, A[1] + (B[1] - A[1]) * s / steps, 14, 14);
    }

    // floor changes and building entry / exit along the route
    let marks = ""; const transitionAt: [number, number][] = [];
    for (let k = 0; k < ids.length - 1; k++) {
      const a = nodes.get(ids[k]), b = nodes.get(ids[k + 1]); if (!a || !b) continue;
      const aHere = a.floor_id === floorId, bHere = b.floor_id === floorId; if (aHere === bHere) continue;
      const n = aHere ? a : b, other = aHere ? b : a, [X, Y] = at(n); transitionAt.push([n.x as number, n.y as number]);
      const fo = other.floor_id ? Number(other.floor_id.split("_F")[1]) : null;
      const via = n.node_type === "elevator" ? "elevator" : n.node_type === "staircase" ? "stairs" : "door";
      const text = fo == null ? (aHere ? "Exit to outdoors" : "Entered from outdoors")
        : aHere ? `${via === "elevator" ? "Elevator" : "Stairs"} ${fo > floor ? "up" : "down"} to Floor ${fo}` : `Arrived from Floor ${fo}`;
      const goingUp = fo != null && (aHere ? fo > floor : fo < floor);                 // leaving upward, or arriving from below
      const arrow = fo == null ? "" : goingUp ? "▲ " : "▼ ";
      marks += g(X, Y, `<line x1="0" y1="0" x2="0" y2="-30"/><circle r="5"/>` + chip(arrow + text, `transition ${via}`, -42), "iso-transition");
      reserve(X, Y, text.length * 6.6 + 30, 26, -42);
    }
    // start, destination and the simulated position
    const pin = (id: string | undefined, kind: "start" | "goal") => {
      const n = here(id); if (!n) return "";
      const [X, Y] = at(n); const room = kind === "goal" && p.goalRoomId ? roomById.get(p.goalRoomId) : kind === "start" && p.startRoomId ? roomById.get(p.startRoomId) : undefined;
      const text = kind === "start" ? "Start" : room ? `Destination · ${room.number}` : "Destination";
      if (id === p.positionNodeId) return g(X, Y, `<circle class="foot" r="4"/>`, `iso-pin ${kind}`, ` data-pin="${kind}"`);   // "You" is standing here
      reserve(X, Y, text.length * 6.6 + 24, 60, -26);
      return g(X, Y, `<line class="stem" x1="0" y1="0" x2="0" y2="-24"/><circle class="foot" r="4"/>` + chip(text, kind, -36), `iso-pin ${kind}`, ` data-pin="${kind}"`);
    };
    let pins = pin(p.endpointNodeIds?.start, "start") + pin(p.endpointNodeIds?.goal, "goal");
    if (me && meXY) {
      reserve(meXY[0], meXY[1], 130, 40, -6);
      pins += g(meXY[0], meXY[1], `<circle class="me-halo" r="20"/><circle class="me-ring" r="10"/><circle class="me-dot nav-me-dot" r="6.5"/>` + chip("You (simulated)", "me", -26)
        + `<title>Simulated position for the selected step (demo): not your real location</title>`, "iso-me nav-me", ` data-position="simulated"`);
    }
    // demo obstacles of the active scenario: a small badge by the hatched area, drawn above the route (it explains a detour)
    let obsBadges = "";
    host.current?.querySelectorAll<SVGElement>("[id^='obstacle_']").forEach(el => {
      if (el.style.display === "none") return;
      const r = el.querySelector("rect"); if (!r) return;
      const x = +r.getAttribute("x")! + +r.getAttribute("width")! / 2, y = +r.getAttribute("y")! + +r.getAttribute("height")! / 2;
      const verified = el.getAttribute("data-status") === "verified" && el.getAttribute("data-verified") === "true";
      const [X, Y] = iso.project(x, y), text = verified ? "✕ Blocked (demo)" : "? Unverified (demo)", w = text.length * 6.6 + 16;
      // the badge sits next to the hatched area, in the first free spot (markers and route chips keep their place)
      const spot = [[0, -18], [0, 22], [w * 0.6, 2], [-w * 0.6, 2], [0, -48]].find(([dx, dy]) => !reserved.some(q => overlap(q, [X + (dx - w / 2) * u, Y + (dy - 11) * u, X + (dx + w / 2) * u, Y + (dy + 11) * u]))) ?? [0, -18];
      obsBadges += g(X, Y, (spot[0] || spot[1] !== -18 ? `<line class="lead" x1="0" y1="0" x2="${spot[0]}" y2="${spot[1]}"/>` : "") + `<g transform="translate(${spot[0]} 0)">${chip(text, verified ? "obstacle" : "obstacle pending", spot[1])}</g>`, "iso-obstacle");
      reserve(X, Y, w, 24, spot[1]); reserved[reserved.length - 1][0] += spot[0] * u; reserved[reserved.length - 1][2] += spot[0] * u;
    });
    // reports: pending "?", verified "✕", the draft "!"
    const shown = p.reports.filter(r => r.floor_id === floorId && (r.status === "pending" || r.status === "verified"));
    const rep = (x: number, y: number, edgeId: string, cls: string, label: string, title: string) => {
      const s = p.segmentOf?.(edgeId);
      if (s) { const A = iso.project(s[0], s[1]), B = iso.project(s[2], s[3]); marks += `<line class="report-seg ${cls}" x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}"/>`; }
      const [X, Y] = iso.project(x, y);
      marks += g(X, Y, `<circle class="report-dot ${cls}" r="11"/><text class="report-q ${cls}" y="5" text-anchor="middle">${label}</text><title>${esc(title)}</title>`, "iso-report");
      reserve(X, Y, 26, 26);
    };
    for (const r of shown) rep(r.x, r.y, r.affected_edge_id, r.report_id === p.focusReportId ? `${r.status} focus` : r.status, r.status === "verified" ? "✕" : "?", `${r.status === "verified" ? "Verified" : "Pending"} report: ${r.location_label}`);
    if (p.draft && p.draft.floor_id === floorId) rep(p.draft.x, p.draft.y, p.draft.affected_edge_id, "draft", "!", "New report (not sent yet)");

    const routeLayer = svg.querySelector("#route_layer"); if (routeLayer) routeLayer.innerHTML = route + obsBadges + pins;
    const markLayer = svg.querySelector("#iso_marks"); if (markLayer) markLayer.innerHTML = marks;

    // labels: features first, then the selected rooms, then rooms by size; each tries full -> number only -> hidden
    const placed: Box[] = [...reserved];
    const fits = (b: Box) => !placed.some(q => overlap(b, q));
    let labels = "";
    for (const f of iso.features) {
      if ((f.kind === "elevator" || f.kind === "stairs") && transitionAt.some(([x, y]) => Math.hypot(x - f.x, y - f.y) < 30)) continue;   // the route chip names it
      const lift = f.kind === "elevator" || f.kind === "stairs" ? ISO.wallM * ISO.unitsPerM : 0;
      const [X, Y] = iso.project(f.x, f.y, lift);
      const short = f.kind === "elevator" ? `E${f.id.split("_")[1]}` : f.kind === "stairs" ? `S${f.id.split("_")[1]}` : f.label;
      let pick: { text: string; dx: number; dy: number; w: number } | null = null;
      for (const text of [f.label, short]) {
        const w = text.length * 6.9 + 32;
        for (const [dx, dy] of [[0, 0], [0, -24], [w * 0.55, -10], [-w * 0.55, -10], [0, 24]]) {
          const b: Box = [X + (dx - w / 2) * u, Y + (dy - 22) * u, X + (dx + w / 2) * u, Y + dy * u];
          if (fits(b)) { pick = { text, dx, dy, w }; placed.push(b); break; }
        }
        if (pick) break;
      }
      if (!pick) continue;
      const { text, dx, dy, w } = pick, ox = dx - w / 2;
      const icon = f.kind === "elevator" ? `<path class="ic" d="M-4 1 L0 -3 L4 1 M-4 4 L0 8 L4 4" transform="translate(${ox + 12} ${dy - 14})"/>`
        : f.kind === "stairs" ? `<path class="ic" d="M-5 5 H-2 V2 H1 V-1 H4 V-4" transform="translate(${ox + 12} ${dy - 11})"/>`
        : f.kind === "entrance" ? `<path class="ic" d="M-4 5 V-5 H4 V5 M1 0 H2" transform="translate(${ox + 12} ${dy - 11})"/>` : `<path class="ic" d="M-5 4 L5 -3" transform="translate(${ox + 12} ${dy - 11})"/>`;
      labels += `<g class="iso-feature ${f.kind}" data-feature="${f.id}" transform="translate(${X.toFixed(1)} ${Y.toFixed(1)}) scale(${u.toFixed(4)})"><title>${esc(f.label + ": " + f.detail)}</title>`
        + (dx || dy ? `<line class="lead" x1="0" y1="0" x2="${dx}" y2="${dy - 2}"/>` : "")
        + `<rect x="${ox}" y="${dy - 22}" width="${w}" height="20" rx="10"/>${icon}<text x="${ox + 22}" y="${dy - 8}">${esc(text)}</text></g>`;
    }
    const order: IsoRoom[] = [...iso.rooms].sort((a, b) => {
      const pri = (r: IsoRoom) => (r.id === p.goalRoomId || r.id === p.startRoomId ? 0 : 1);
      return pri(a) - pri(b) || b.area - a.area;
    });
    const nameMax = zoomLevel >= 2 ? 22 : 16;
    for (const r of order) {
      if (r.type === "stairwell") continue;                                  // the stairs marker names it
      const [X, Y] = iso.project(r.x, r.y);
      const sel = r.id === p.goalRoomId ? "goal" : r.id === p.startRoomId ? "start" : "";
      const name = r.name.length > nameMax ? r.name.slice(0, nameMax - 1) + "…" : r.name;
      const numW = r.number.length * 7.6 + 14, nameW = name.length * 6.1 + 6;
      const screenArea = r.area * 0.866 * px * px;
      const variants = [
        { box: [X - Math.max(numW, nameW) / 2 * u, Y - 10 * u, X + Math.max(numW, nameW) / 2 * u, Y + 24 * u] as Box, full: true },
        { box: [X - numW / 2 * u, Y - 9 * u, X + numW / 2 * u, Y + 9 * u] as Box, full: false },
      ];
      let chosen = variants.find(v => (v.full ? screenArea > Math.max(numW, nameW) * 34 * 0.9 : true) && fits(v.box));
      if (!chosen && sel) chosen = variants[1];
      if (!chosen) continue;
      placed.push(chosen.box);
      labels += `<g class="iso-room-lbl${sel ? " " + sel : ""}" data-room="${r.id}" transform="translate(${X.toFixed(1)} ${Y.toFixed(1)}) scale(${u.toFixed(4)})"><title>${esc(`${r.name}, room ${r.number}`)}</title>`
        + `<rect class="num-bg" x="${-numW / 2}" y="-9" width="${numW}" height="18" rx="9"/><text class="num" y="4.5">${esc(r.number)}</text>`
        + (chosen.full ? `<text class="nm" y="21">${esc(name)}</text>` : "") + `</g>`;
    }
    const labelLayer = svg.querySelector("#iso_labels"); if (labelLayer) labelLayer.innerHTML = labels;
  });

  // ---- the floor stack (which floor, and how floors connect) ----
  const routeFloors = useMemo(() => new Set(p.routeNodeIds.map(id => nodes.get(id)?.floor_id).filter(Boolean).map(f => Number((f as string).split("_F")[1]))), [p.routeNodeIds, nodes]);
  const north = useMemo(() => { const a = iso.project(0, 0), b = iso.project(0, -100); return Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI; }, [iso]);
  const floors = Array.from({ length: floorCount }, (_, i) => floorCount - i);

  return (
    <div className="iso-map">
      <div className="iso-stage" ref={stage}>
        <div ref={host} key={floor} className={p.reportMode ? "iso-canvas indoor-svg reporting" : "iso-canvas indoor-svg"} data-view="isometric"
          style={{ aspectRatio: `${W.toFixed(0)} / ${H.toFixed(0)}`, touchAction: zoomLevel > 1.01 ? "none" : "pan-y" }}
          tabIndex={0} role="group" aria-roledescription="map" aria-label={`Floor ${floor} of the Academic Building, 3D view. Arrow keys pan, plus and minus zoom, 0 resets the view.`}
          onClick={click} onKeyDown={onKey} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={e => { if (e.pointerType === "mouse" && !ptrs.current.size) setInfo(null); }}
          dangerouslySetInnerHTML={{ __html: iso.svg }} />
        <div className="iso-hud tl" aria-hidden="true">
          <div className="iso-floorbadge"><span className="lbl">Floor</span><span className="n">{floor}</span><span className="of">of {floorCount}</span></div>
          <svg className="iso-stack" viewBox="0 0 64 70" width="52" height="57">
            {floors.map((f, i) => { const y = 10 + i * 18; return (
              <g key={f} className={f === floor ? "on" : routeFloors.has(f) ? "route" : ""}>
                <path d={`M8 ${y + 8} L32 ${y} L56 ${y + 8} L32 ${y + 16} Z`} /><text x="60" y={y + 12}>{f}</text>
              </g>); })}
            <line x1="32" y1="18" x2="32" y2={10 + (floorCount - 1) * 18 + 8} className="shaft" />
          </svg>
          <span className="iso-synth">Synthetic plan</span>
        </div>
        <div className="iso-hud tr" aria-hidden="true"><span className="iso-compass" style={{ transform: `rotate(${north.toFixed(0)}deg)` }}>▲</span><span className="iso-n">N</span></div>
        <div className="iso-hud br iso-controls" role="group" aria-label="Map controls">
          <button type="button" onClick={() => zoomAt(1.4)} disabled={zoomLevel >= 6.9} aria-label="Zoom in on floor plan">+</button>
          <button type="button" onClick={() => zoomAt(1 / 1.4)} disabled={zoomLevel <= 1.001} aria-label="Zoom out of floor plan">−</button>
          <button type="button" onClick={() => setCam(fit)} disabled={zoomLevel <= 1.001 && cam.x === 0 && cam.y === 0} aria-label="Reset view" title="Reset view">⤢</button>
          {meXY && <button type="button" onClick={() => centerOn(meXY[0], meXY[1], 2)} aria-label="Center on your simulated position" title="Center on you">◎</button>}
        </div>
      </div>
      <p className="iso-info" aria-live="polite">{info ?? (p.reportMode ? "Tap the map where the obstacle is." : p.onSelectRoom ? "Point at or tap a room to see what it is; tap to choose it." : "Point at or tap a room to see what it is.")}</p>
      <ul className="iso-legend" aria-label="Map key">
        <li><span className="k k-route" />Route</li>
        <li><span className="k k-cur" />Current step</li>
        <li><span className="k k-done" />Done</li>
        <li><span className="k k-me" />You (simulated)</li>
        <li><span className="k k-elev" />Elevator</li>
        <li><span className="k k-stairs" />Stairs (not step-free)</li>
        <li><span className="k k-door" />Doorway</li>
        <li><span className="k k-obs" />Blocked (verified)</li>
      </ul>
      <p className="map-note iso-assume">3D view of the <strong>synthetic</strong> plan. Walls are drawn {ISO.wallM} m high and floors {ISO.floorGapM} m apart: visual assumptions, not measured. Routes and distances are unchanged. Drag to move, Ctrl/⌘ + scroll or pinch to zoom.</p>
    </div>
  );
}
