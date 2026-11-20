import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_LABELS, type AppData } from "../data";
import type { RouteFound, UNode } from "../routing/unifiedRouting";

const MLON = 92450, MLAT = 110921;
const proj = ([lon, lat]: [number, number]): [number, number] => [(lon + 84.52) * MLON, -(lat - 33.938) * MLAT];
export interface OutdoorMapProps {
  data: AppData; route?: RouteFound | null; activeNodeIds?: string[]; startNode?: string | null; goalNode?: string | null;
  pickMode?: "start" | "goal" | null; onPickNode?: (nodeId: string) => void;
  /** the building chosen in the building selector: highlighted, and the zoom button goes to it */
  focusBuildingId?: string | null; focusRequest?: { id: string; n: number } | null;
  /** open reports per building (all reports are indoor today): drawn as a badge on the building */
  reportCounts?: Record<string, { pending: number; verified: number }>;
  /** other route alternatives, drawn faintly under the selected route */
  altRoutes?: RouteFound[];
  /** step-by-step navigation: the SIMULATED position, and the current step's nodes (the map zooms to them) */
  positionNodeId?: string | null; focusNodeIds?: string[];
}
export function OutdoorMap({ data, route, activeNodeIds, startNode, goalNode, pickMode, onPickNode, focusBuildingId = "BLD001", focusRequest, reportCounts = {}, altRoutes = [], positionNodeId = null, focusNodeIds }: OutdoorMapProps) {
  const nodes = useMemo(() => new Map(data.unified.nodes.map(n => [n.node_id, n])), [data]);
  const outdoorNodes = useMemo(() => data.unified.nodes.filter(n => n.domain === "outdoor"), [data]);
  const entrances = outdoorNodes.filter(n => n.node_type === "entrance" || n.node_type === "ramp_entrance");
  const bbox = useMemo(() => {
    const pts = data.outdoorEdges.flatMap(e => e.geometry.map(proj)); const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30, w: Math.max(...xs) - Math.min(...xs) + 60, h: Math.max(...ys) - Math.min(...ys) + 60 };
  }, [data]);
  const [zoom, setZoom] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const vb = zoom ?? bbox;
  // the map is drawn in metres; symbols and labels are sized in screen pixels times u (metres per pixel) so they never balloon when zoomed in
  const svgRef = useRef<SVGSVGElement>(null);
  const [pxW, setPxW] = useState(900);
  useEffect(() => {
    const el = svgRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 0) setPxW(r.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const u = vb.w / pxW;
  const txt = (px: number, extra: React.CSSProperties = {}): React.CSSProperties => ({ fontSize: `${px * u}px`, strokeWidth: `${3.5 * u}px`, ...extra });
  const placeName = (id: string) => DISPLAY_LABELS[id] ?? id.replace("oe_", "");
  const edgeById = useMemo(() => new Map(data.outdoorEdges.map(e => [e.edge_id, e])), [data]);
  const poly = (c: [number, number][]) => c.map(proj).map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const routeLines = useMemo(() => {                       // outdoor edges of the route, oriented in travel direction
    if (!route) return [] as { id: string; pts: string; active: boolean }[];
    const act = new Set(activeNodeIds ?? []);
    return route.links.flatMap((id, i) => {
      const e = edgeById.get(id); if (!e) return [];
      const from = nodes.get(route.nodes[i]) as UNode; let g = e.geometry;
      if (Math.abs(g[0][0] - (from.lon as number)) > 1e-6 || Math.abs(g[0][1] - (from.lat as number)) > 1e-6) g = [...g].reverse();
      return [{ id, pts: poly(g), active: act.size === 0 || (act.has(route.nodes[i]) && act.has(route.nodes[i + 1])) }];
    });
  }, [route, activeNodeIds, edgeById, nodes]);
  const marker = (id: string | null | undefined, cls: string, label: string) => {
    const n = id ? nodes.get(id) : null; if (!n || n.domain !== "outdoor") return null; const [x, y] = proj([n.lon as number, n.lat as number]);
    const here = id === positionNodeId;                                  // the simulated "you" marker labels this spot instead
    return <g key={cls} className={cls}><circle cx={x} cy={y} r={7 * u} style={{ strokeWidth: `${2 * u}px` }} />{!here && <text x={x} y={y - 12 * u} textAnchor="middle" style={txt(12)}>{label}</text>}</g>;
  };
  const onClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (!pickMode || !onPickNode) return; const svg = ev.currentTarget, r = svg.getBoundingClientRect();
    const x = vb.x + ((ev.clientX - r.left) / r.width) * vb.w, y = vb.y + ((ev.clientY - r.top) / r.height) * vb.h;
    let best: string | null = null, bd = 14 * u;
    for (const n of outdoorNodes) { const [px, py] = proj([n.lon as number, n.lat as number]); const dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; best = n.node_id; } }
    if (best) onPickNode(best);
  };
  const zoomTo = (f: number) => { const c = { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 }; const w = vb.w / f, h = vb.h / f; setZoom({ x: c.x - w / 2, y: c.y - h / 2, w, h }); };
  const focused = data.buildings.find(f => f.properties.building_id === focusBuildingId);
  const zoomToBuilding = (id: string | null | undefined) => { const b = data.buildings.find(f => f.properties.building_id === id); if (!b) return; const p = b.geometry.coordinates[0].map(proj); const xs = p.map(q => q[0]), ys = p.map(q => q[1]); setZoom({ x: Math.min(...xs) - 60, y: Math.min(...ys) - 60, w: Math.max(...xs) - Math.min(...xs) + 120, h: Math.max(...ys) - Math.min(...ys) + 120 }); };
  useEffect(() => { if (focusRequest) zoomToBuilding(focusRequest.id); }, [focusRequest]);   // a new pick in the building selector zooms there
  // a new step: zoom to the outdoor part of that step's stretch (at least ~110 m wide, so there is context around it)
  const focusKey = (focusNodeIds ?? []).join("|");
  useEffect(() => {
    const pts = (focusNodeIds ?? []).map(id => nodes.get(id)).filter((n): n is UNode => !!n && n.domain === "outdoor").map(n => proj([n.lon as number, n.lat as number]));
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = Math.max(220, Math.max(...xs) - Math.min(...xs) + 80), h = Math.max(160, Math.max(...ys) - Math.min(...ys) + 80);
    setZoom({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [focusKey]);
  const me = positionNodeId ? nodes.get(positionNodeId) : null;
  const mePt = me && me.domain === "outdoor" ? proj([me.lon as number, me.lat as number]) : null;
  return (
    <div className="map-card" data-testid="outdoor-map">
      <div className="map-tools" role="toolbar" aria-label="Outdoor map zoom">
        <button type="button" onClick={() => zoomTo(1.5)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoomTo(1 / 1.5)} aria-label="Zoom out">-</button>
        <button type="button" onClick={() => setZoom(null)}>Whole campus</button>{focused && <button type="button" onClick={() => zoomToBuilding(focusBuildingId)}>{(focused.properties.name ?? "Building").replace(/^[A-Z]\d?\s*-\s*/, "")}</button>}
        {pickMode && <span className="pick-hint">Click near a path node to set the {pickMode === "start" ? "starting location" : "destination"}</span>}
      </div>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={pickMode ? "outdoor-svg picking" : "outdoor-svg"} onClick={onClick} role="img" aria-label="Outdoor campus map: buildings, walkable paths, entrances and the selected route">
        <g id="outdoor-buildings">{data.buildings.map(b => <polygon key={b.properties.id} points={poly(b.geometry.coordinates[0])} className={["bld", b.properties.building_id === "BLD001" ? "bld-indoor" : "", b.properties.building_id && b.properties.building_id === focusBuildingId ? "bld-focus" : ""].filter(Boolean).join(" ")}
          data-building-id={b.properties.building_id ?? undefined}><title>{b.properties.name ?? "building"}{b.properties.building_id === "BLD001" ? " (synthetic indoor map available)" : b.properties.building_id ? " (outdoor only, no indoor map)" : ""}</title></polygon>)}</g>
        <g id="outdoor-paths">{data.outdoorEdges.map(e => <polyline key={e.edge_id} points={poly(e.geometry)} className={e.stairs_only ? "path steps" : e.edge_type === "entrance_link" ? "path link" : "path"} />)}</g>
        <g id="outdoor-entrances">{entrances.map(n => { const [x, y] = proj([n.lon as number, n.lat as number]); const marked = n.node_id === startNode || n.node_id === goalNode;   // the Start/Destination marker labels this spot instead
              // names only once zoomed in (under ~1.2 m per pixel), so the campus view is not covered in labels
              return <g key={n.node_id} className="entrance"><rect x={x - 5 * u} y={y - 5 * u} width={10 * u} height={10 * u} transform={`rotate(45 ${x} ${y})`} style={{ strokeWidth: `${1.5 * u}px` }} /><title>{`${placeName(n.node_id)} (location provisional, not field-checked)`}</title>{!marked && u < 1.2 && <text x={x + 9 * u} y={y - 7 * u} style={txt(11)}>{placeName(n.node_id)}</text>}</g>; })}</g>
        <g id="outdoor-alt-routes">{altRoutes.flatMap((r, k) => r.links.flatMap(id => { const e = edgeById.get(id); return e ? [<polyline key={`${k}-${id}`} points={poly(e.geometry)} className="alt-route-line" />] : []; }))}</g>
        <g id="outdoor-route">{routeLines.map(l => <polyline key={l.id} points={l.pts} className={l.active ? "route-line active" : "route-line"} data-edge={l.id} />)}</g>
        {marker(startNode, "marker start", "Start")}{marker(goalNode, "marker goal", "Destination")}
        {mePt && <g className="nav-me" data-position="simulated"><circle className="nav-me-ring" cx={mePt[0]} cy={mePt[1]} r={12 * u} style={{ strokeWidth: `${2 * u}px` }} /><circle className="nav-me-dot" cx={mePt[0]} cy={mePt[1]} r={6 * u} style={{ strokeWidth: `${2.5 * u}px` }} />
          <text x={mePt[0] + 14 * u} y={mePt[1] + 4 * u} style={txt(12.5)}>You (simulated)</text><title>Simulated position for the selected step (demo): not your real location</title></g>}
        <g id="outdoor-report-badges">{data.buildings.filter(b => b.properties.building_id && reportCounts[b.properties.building_id]).map(b => {
          const c = reportCounts[b.properties.building_id as string], open = c.pending + c.verified; if (!open) return null;
          const p = b.geometry.coordinates[0].map(proj), x = p.reduce((s, q) => s + q[0], 0) / p.length, y = p.reduce((s, q) => s + q[1], 0) / p.length;
          return <g key={b.properties.id} className={c.verified ? "report-badge verified" : "report-badge"} data-building-id={b.properties.building_id ?? undefined}>
            <title>{`${c.pending} pending, ${c.verified} verified obstacle report(s) inside`}</title><circle cx={x} cy={y} r={11 * u} style={{ strokeWidth: `${2 * u}px` }} /><text x={x} y={y + 4 * u} textAnchor="middle" style={{ fontSize: `${12 * u}px` }}>{open}</text></g>;
        })}</g>
      </svg>
      <p className="map-note"><span className="key key-route" /> route <span className="key key-steps" /> steps <span className="key key-door" /> building entrance (location not yet field-checked) &middot; Paths: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>. Surfaces and slopes are not mapped.</p>
    </div>
  );
}
