// Isometric ("3D-style") view of an existing indoor floor SVG. DISPLAY ONLY: the routing data, node coordinates and route
// calculations are never changed. Everything is derived from the floor SVG itself:
//   - floor shapes (footprint, rooms, hallways, doors, stairs, elevators, obstacles) are projected with one fixed isometric matrix
//     and restyled as an architectural model (warm floors, sand hallways, cool restrooms, visible door thresholds);
//   - walls are the existing wall outlines, raised as light panels with crisp tops, with openings left at the drawn door gaps;
//   - the drawn elevators and stairwells are raised as coloured shafts (so the vertical connections read at a glance);
//   - floors below the current one are shown as thin slabs 4 m down;
//   - labels, the route and markers are NOT baked in: IndoorMap draws them on top, upright and at a constant on-screen size,
//     from the room / feature list returned here.
// Visual assumptions (not in the data, labelled on the map): walls 3 m high, floors 4 m apart.
// Nothing is invented: no walls, doors, rooms or stair directions are added; only drawn geometry is raised, projected or restyled.

export const ISO = { unitsPerM: 10, wallM: 3, floorGapM: 4, slabM: 0.6 } as const;
const C = Math.cos(Math.PI / 6), S = 0.5;
const SVG_NS = "http://www.w3.org/2000/svg";
const KEEP_AT_ROOT = new Set(["defs", "style", "title", "desc", "metadata"]);
const HIDE_IN_ISO = ["layer_annotations", "north_arrow", "scale_bar", "layer_legend", "accessible_routes", "layer_nav_graph"];

export interface IsoProjection {
  /** plan point (SVG units) and height above this floor (SVG units) -> point in the isometric SVG */
  project(x: number, y: number, z?: number): [number, number];
  /** point in the isometric SVG (on this floor's surface) -> plan point (SVG units) */
  unproject(x: number, y: number): [number, number];
}
export function makeProjection(ox: number, oy: number): IsoProjection {
  return {
    project: (x, y, z = 0) => [ox + (x - y) * C, oy + (x + y) * S - z],
    unproject: (X, Y) => { const a = (X - ox) / C, b = (Y - oy) / S; return [(a + b) / 2, (b - a) / 2]; },
  };
}

/** absolute/relative M/L/H/V/Z path data -> polylines (curves end the current run; they are not walls) */
export function pathPolylines(d: string): [number, number][][] {
  const out: [number, number][][] = []; let cur: [number, number][] = []; let x = 0, y = 0, sx = 0, sy = 0;
  const re = /([MLHVZmlhvz])([^MLHVZmlhvzACSQTacsqt]*)|([ACSQTacsqt])[^MLHVZmlhvzACSQTacsqt]*/g; let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[3]) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const rel = c === c.toLowerCase() && c !== "z" && c !== "Z", C_ = c.toUpperCase();
    if (C_ === "M") { if (cur.length > 1) out.push(cur); x = rel ? x + n[0] : n[0]; y = rel ? y + n[1] : n[1]; sx = x; sy = y; cur = [[x, y]];
      for (let i = 2; i + 1 < n.length; i += 2) { x = rel ? x + n[i] : n[i]; y = rel ? y + n[i + 1] : n[i + 1]; cur.push([x, y]); } }
    else if (C_ === "L") for (let i = 0; i + 1 < n.length; i += 2) { x = rel ? x + n[i] : n[i]; y = rel ? y + n[i + 1] : n[i + 1]; cur.push([x, y]); }
    else if (C_ === "H") for (const v of n) { x = rel ? x + v : v; cur.push([x, y]); }
    else if (C_ === "V") for (const v of n) { y = rel ? y + v : v; cur.push([x, y]); }
    else if (C_ === "Z") { cur.push([sx, sy]); x = sx; y = sy; if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const polyArea = (p: [number, number][]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

type Seg = [number, number, number, number];
/** wall segments from the wall outlines, de-duplicated (rooms share walls), with the drawn door gaps cut out */
export function wallSegments(outlines: [number, number][][], gaps: Seg[]): Seg[] {
  const seen = new Set<string>(); const segs: Seg[] = [];
  for (const pl of outlines) for (let i = 0; i < pl.length - 1; i++) {
    const [a, b] = [pl[i], pl[i + 1]]; if (a[0] === b[0] && a[1] === b[1]) continue;
    const k = [a, b].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join("|");
    if (seen.has(k)) continue; seen.add(k); segs.push([a[0], a[1], b[0], b[1]]);
  }
  const out: Seg[] = [];
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); let cuts: [number, number][] = [];
    for (const [gx1, gy1, gx2, gy2] of gaps) {
      const t = (px: number, py: number) => ((px - ax) * dx + (py - ay) * dy) / (L * L);
      const off = (px: number, py: number) => Math.abs((px - ax) * dy - (py - ay) * dx) / L;
      if (off(gx1, gy1) > 2 || off(gx2, gy2) > 2) continue;
      const t1 = Math.max(0, Math.min(t(gx1, gy1), t(gx2, gy2))), t2 = Math.min(1, Math.max(t(gx1, gy1), t(gx2, gy2)));
      if (t2 > t1) cuts.push([t1, t2]);
    }
    cuts = cuts.sort((p, q) => p[0] - q[0]); let s = 0;
    for (const [t1, t2] of cuts) { if (t1 > s) out.push([ax + dx * s, ay + dy * s, ax + dx * t1, ay + dy * t1]); s = Math.max(s, t2); }
    if (s < 1) out.push([ax + dx * s, ay + dy * s, bx, by]);
  }
  return out.filter(([a, b, c, d]) => Math.hypot(c - a, d - b) > 0.5);
}

/** a room as the label layer needs it (plan coordinates; the label layer projects them) */
export interface IsoRoom { id: string; number: string; name: string; type: string; accessible: boolean; x: number; y: number; area: number }
/** elevators, stairwells, entrances and ramps: shown as labelled markers */
export interface IsoFeature { id: string; kind: "elevator" | "stairs" | "entrance" | "ramp"; label: string; detail: string; x: number; y: number }
export interface IsoResult extends IsoProjection {
  svg: string; width: number; height: number; wallCount: number; doorGapCount: number;
  rooms: IsoRoom[]; features: IsoFeature[];
  /** plan-space bounding box of the building outline */
  outline: [number, number][];
}

const ROOM_TONE: Record<string, string> = {
  classroom: "learn", lecture_room: "learn", computer_lab: "learn", research_lab: "learn", study_room: "learn", collaboration_space: "learn",
  conference_room: "learn", open_study_area: "learn", faculty_office: "office", department_office: "office", reception: "office", break_room: "office",
  restroom: "wc", accessible_restroom: "wc", lobby: "lobby", elevator_lobby: "lobby", stairwell: "stair", service: "service",
};

/** Build the isometric SVG for one floor.
 *  floorsBelow: floors to show as slabs underneath (current floor number - 1); maxBelow: room reserved under the floor, the
 *  same for every floor, so the camera, scale and alignment stay identical when switching floors. */
export function buildIsoSvg(svgText: string, opts: { floor: number; floorsBelow: number; maxBelow?: number }): IsoResult {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  const mk = (tag: string, attrs: Record<string, string | number> = {}, text?: string) => {
    const e = doc.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text != null) e.textContent = text; return e;
  };
  const fp = pathPolylines(root.querySelector("#footprint")?.getAttribute("d") ?? "")[0] ?? [];
  const xs = fp.map(p => p[0]), ys = fp.map(p => p[1]);
  const U = ISO.unitsPerM, wallZ = ISO.wallM * U, gapZ = ISO.floorGapM * U, slabZ = ISO.slabM * U;
  const maxBelow = Math.max(opts.maxBelow ?? opts.floorsBelow, opts.floorsBelow);
  const M = 30, top = wallZ + 30, below = maxBelow * gapZ + slabZ + 24;
  const corners = fp.flatMap(([x, y]) => [[x - M, y - M], [x + M, y + M], [x - M, y + M], [x + M, y - M]]).map(([x, y]) => [(x - y) * C, (x + y) * S]);
  const bx0 = Math.min(...corners.map(c => c[0])), bx1 = Math.max(...corners.map(c => c[0]));
  const by0 = Math.min(...corners.map(c => c[1])), by1 = Math.max(...corners.map(c => c[1]));
  const P = makeProjection(-bx0, -by0 + top);
  const W = bx1 - bx0, H = by1 - by0 + top + below;
  const f1 = (v: number) => v.toFixed(1);
  const pts = (pl: [number, number][], z = 0) => pl.map(([x, y]) => P.project(x, y, z).map(f1).join(",")).join(" ");

  // ---- read the drawing (before it is moved) ----
  const labelOf = new Map<string, string>();
  root.querySelectorAll("[id^='label_room_']").forEach(g => labelOf.set(g.id.replace("label_", ""), g.querySelector(".lbl-name")?.textContent?.trim() ?? ""));
  const rooms: IsoRoom[] = [];
  root.querySelectorAll("#layer_rooms [id^='room_']").forEach(el => {
    const id = el.id, poly = pathPolylines(el.getAttribute("d") ?? "")[0] ?? [];
    const lg = root.querySelector(`#label_${id} .lbl-name`);
    const cx = lg ? +(lg.getAttribute("x") ?? 0) : poly.reduce((a, p) => a + p[0], 0) / Math.max(1, poly.length);
    const cy = lg ? +(lg.getAttribute("y") ?? 0) : poly.reduce((a, p) => a + p[1], 0) / Math.max(1, poly.length);
    const full = labelOf.get(id) || id, number = (id.match(/(\d+)$/) ?? [])[1] ?? "";
    rooms.push({ id, number, name: full.replace(new RegExp(`\\s*${number}$`), "") || full, type: el.getAttribute("data-room-type") ?? "room",
      accessible: el.getAttribute("data-accessible") === "true", x: cx, y: cy, area: polyArea(poly) });
  });
  const features: IsoFeature[] = [];
  const bbox = (g: Element) => {
    const v: number[][] = [];
    g.querySelectorAll("line").forEach(l => v.push([+l.getAttribute("x1")!, +l.getAttribute("y1")!], [+l.getAttribute("x2")!, +l.getAttribute("y2")!]));
    g.querySelectorAll("rect").forEach(r => { const x = +r.getAttribute("x")!, y = +r.getAttribute("y")!; v.push([x, y], [x + +r.getAttribute("width")!, y + +r.getAttribute("height")!]); });
    g.querySelectorAll("circle").forEach(c => v.push([+c.getAttribute("cx")!, +c.getAttribute("cy")!]));
    if (!v.length) return null;
    return [Math.min(...v.map(p => p[0])), Math.min(...v.map(p => p[1])), Math.max(...v.map(p => p[0])), Math.max(...v.map(p => p[1]))] as [number, number, number, number];
  };
  const shaftBoxes: { kind: "elevator" | "stairs"; b: [number, number, number, number] }[] = [];
  root.querySelectorAll("#layer_elevators > g[id^='elevator_']").forEach(g => {
    const b = bbox(g); if (!b) return; const n = g.id.split("_")[1];
    features.push({ id: g.id, kind: "elevator", label: `Elevator ${n}`, detail: g.getAttribute("data-accessible") === "true" ? "Elevator, step-free (not field-checked)" : "Elevator", x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });
    shaftBoxes.push({ kind: "elevator", b });
  });
  root.querySelectorAll("#layer_stairs > g[id^='stairwell_']").forEach(g => {
    const b = bbox(g); if (!b) return; const n = g.id.split("_")[1];
    features.push({ id: g.id, kind: "stairs", label: `Stairs ${n}`, detail: "Stairs only: not step-free", x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });
    shaftBoxes.push({ kind: "stairs", b });
  });
  root.querySelectorAll("#layer_accessibility > g[id^='entrance_']").forEach(g => {
    const gap = g.querySelector("line.door-gap"); const b = gap ? [+gap.getAttribute("x1")!, +gap.getAttribute("y1")!, +gap.getAttribute("x2")!, +gap.getAttribute("y2")!] : bbox(g);
    if (!b) return; const acc = g.getAttribute("data-accessible") === "true";
    features.push({ id: g.id, kind: "entrance", label: acc ? "Entrance" : "Entrance (steps)", detail: acc ? "Building entrance, marked accessible (not field-checked)" : "Building entrance with steps", x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });
  });
  root.querySelectorAll("#layer_ramps > g[id^='ramp_']").forEach(g => {
    const b = bbox(g); if (!b) return;
    features.push({ id: g.id, kind: "ramp", label: "Ramp", detail: "Ramp (not field-checked)", x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });
  });

  // ---- 1. the floor: everything drawable goes into one projected group; text is redrawn upright by the label layer ----
  const plane = mk("g", { id: "iso_plane", transform: `matrix(${C} ${S} ${-C} ${S} ${P.project(0, 0)[0].toFixed(3)} ${P.project(0, 0)[1].toFixed(3)})` });
  const routeLayer = root.querySelector("#route_layer");
  for (const el of [...root.children]) { if (KEEP_AT_ROOT.has(el.localName) || el === routeLayer) continue; plane.appendChild(el); }
  for (const id of HIDE_IN_ISO) plane.querySelector(`#${id}`)?.setAttribute("style", "display:none");
  plane.querySelectorAll("text, use").forEach(t => t.remove());                         // labels and icons are redrawn upright
  plane.querySelectorAll("#layer_rooms [id^='room_']").forEach(el => el.setAttribute("data-tone", ROOM_TONE[el.getAttribute("data-room-type") ?? ""] ?? "learn"));

  // ---- 2. ground: shadow, floors below, this floor's slab ----
  const ground = mk("g", { id: "iso_ground", "pointer-events": "none" });
  const sh = P.project(0, 0, -slabZ), sh2 = P.project(0, 0, -slabZ - 6);
  ground.appendChild(mk("polygon", { class: "iso-shadow", points: pts(fp, -slabZ - 6), transform: `translate(${f1(18)} ${f1(10 + sh2[1] - sh[1] - 6)})` }));
  for (let k = opts.floorsBelow; k >= 1; k--) {
    ground.appendChild(mk("polygon", { class: "iso-slab-below", points: pts(fp, -k * gapZ) }));
  }
  // slab sides: the footprint edges dropped by the slab thickness (the visible front faces only)
  for (let i = 0; i < fp.length - 1; i++) {
    const [ax, ay] = fp[i], [bx, by] = fp[i + 1];
    const a = P.project(ax, ay), b = P.project(bx, by), a2 = P.project(ax, ay, -slabZ), b2 = P.project(bx, by, -slabZ);
    ground.appendChild(mk("polygon", { class: Math.abs(bx - ax) >= Math.abs(by - ay) ? "iso-slab-side x" : "iso-slab-side y", points: [a, b, b2, a2].map(p => p.map(f1).join(",")).join(" ") }));
  }

  // ---- 3. walls and shafts, back to front ----
  const outlines = [...plane.querySelectorAll("#layer_walls_interior path, #layer_walls_exterior path")].map(p => ({ ext: !!p.closest("#layer_walls_exterior"), pls: pathPolylines(p.getAttribute("d") ?? "") }));
  const gaps: Seg[] = [...plane.querySelectorAll("line.door-gap")].map(l => ["x1", "y1", "x2", "y2"].map(a => +l.getAttribute(a)!) as Seg);
  const extKeys = new Set<string>();
  for (const o of outlines) if (o.ext) for (const pl of o.pls) for (let i = 0; i < pl.length - 1; i++) extKeys.add([pl[i], pl[i + 1]].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join("|"));
  const segs = wallSegments(outlines.flatMap(o => o.pls), gaps);
  type Solid = { depth: number; draw: () => void };
  const solids: Solid[] = [];
  const walls = mk("g", { id: "iso_walls", "pointer-events": "none" });
  const onExt = (s: Seg) => fp.some((p, i) => i < fp.length - 1 && Math.abs((s[0] - p[0]) * (fp[i + 1][1] - p[1]) - (s[1] - p[1]) * (fp[i + 1][0] - p[0])) / Math.hypot(fp[i + 1][0] - p[0], fp[i + 1][1] - p[1]) < 1.5
    && Math.abs((s[2] - p[0]) * (fp[i + 1][1] - p[1]) - (s[3] - p[1]) * (fp[i + 1][0] - p[0])) / Math.hypot(fp[i + 1][0] - p[0], fp[i + 1][1] - p[1]) < 1.5);
  for (const s of segs) {
    const [ax, ay, bx, by] = s, ext = onExt(s);
    solids.push({ depth: ax + ay + bx + by, draw: () => {
      const along = Math.abs(bx - ax) >= Math.abs(by - ay) ? "x" : "y";
      const q = [P.project(ax, ay), P.project(bx, by), P.project(bx, by, wallZ), P.project(ax, ay, wallZ)];
      walls.appendChild(mk("polygon", { class: `iso-wall ${along}${ext ? " ext" : ""}`, points: q.map(p => p.map(f1).join(",")).join(" ") }));
      walls.appendChild(mk("line", { class: ext ? "iso-wall-top ext" : "iso-wall-top", x1: f1(q[3][0]), y1: f1(q[3][1]), x2: f1(q[2][0]), y2: f1(q[2][1]) }));
    } });
  }
  void extKeys;
  for (const { kind, b } of shaftBoxes) {
    const [x0, y0, x1, y1] = b;
    solids.push({ depth: (x0 + y0 + x1 + y1) + 0.5, draw: () => {
      const z = wallZ;
      const box = (pl: [number, number][], zz: number) => pl.map(([x, y]) => P.project(x, y, zz));
      const top = box([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z);
      const left = [P.project(x0, y1), P.project(x1, y1), P.project(x1, y1, z), P.project(x0, y1, z)];   // faces toward the viewer
      const right = [P.project(x1, y0), P.project(x1, y1), P.project(x1, y1, z), P.project(x1, y0, z)];
      const g = mk("g", { class: `iso-shaft ${kind}` });
      for (const [cls, q] of [["l", left], ["r", right], ["t", top]] as const) g.appendChild(mk("polygon", { class: cls, points: q.map(p => p.map(f1).join(",")).join(" ") }));
      walls.appendChild(g);
    } });
  }
  solids.sort((a, b) => a.depth - b.depth).forEach(s => s.draw());

  // shafts down to the floors below (the drawn elevators and stairs continue between floors)
  const links = mk("g", { id: "iso_links", "pointer-events": "none" });
  if (opts.floorsBelow > 0) for (const { kind, b: [x0, y0, x1, y1] } of shaftBoxes) for (const [x, y] of [[x0, y1], [x1, y1], [x1, y0]]) {
    const a = P.project(x, y, -slabZ), b = P.project(x, y, -opts.floorsBelow * gapZ);
    links.appendChild(mk("line", { class: `iso-link ${kind}`, x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1]) }));
  }

  const defs = mk("defs");
  const style = mk("style", {}, ISO_CSS);
  const desc = mk("desc", {}, `Floor ${opts.floor}, isometric view of the SYNTHETIC floor plan (not an official KSU plan). Visual assumptions: walls 3 m high, floors 4 m apart. Routes and distances are calculated on the flat plan and are not affected.`);
  root.setAttribute("viewBox", `0 0 ${f1(W)} ${f1(H)}`);
  root.setAttribute("width", W.toFixed(0)); root.setAttribute("height", H.toFixed(0));
  root.setAttribute("data-view", "isometric"); root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.insertBefore(desc, root.firstChild);
  root.appendChild(defs); root.appendChild(style);
  root.appendChild(ground); root.appendChild(links); root.appendChild(plane); root.appendChild(walls);
  root.appendChild(mk("g", { id: "iso_marks", "pointer-events": "none" }));             // obstacle badges, transitions (IndoorMap)
  if (routeLayer) root.appendChild(routeLayer); else root.appendChild(mk("g", { id: "route_layer" }));
  root.appendChild(mk("g", { id: "iso_labels" }));                                       // room and feature labels (IndoorMap)
  return { svg: new XMLSerializer().serializeToString(root), width: W, height: H, project: P.project, unproject: P.unproject,
    wallCount: segs.length, doorGapCount: gaps.length, rooms, features, outline: fp };
}

// Materials: one light source from the upper left; the floor plan stays readable through the walls.
const ISO_CSS = `
#iso_plane .ip-bg{fill:none}
#iso_plane .ip-fp{fill:#efe7d6}
#iso_plane .ip-hall{fill:#f2e6cd;stroke:none}
#iso_plane #layer_rooms [id^='room_']{fill:#fffcf5;stroke:#d9cdb5;stroke-width:.8;transition:fill .15s}
#iso_plane #layer_rooms [data-tone='office']{fill:#f7f3ea}
#iso_plane #layer_rooms [data-tone='wc']{fill:#e9f2f8}
#iso_plane #layer_rooms [data-tone='lobby']{fill:#f5ead6}
#iso_plane #layer_rooms [data-tone='stair']{fill:#e4f1ec}
#iso_plane #layer_rooms [data-tone='service']{fill:#ece7de}
#iso_plane #layer_rooms [id^='room_']:hover{fill:#fff1cf}
#iso_plane #layer_rooms [data-selected='start']{fill:#e3ecff!important;stroke:#1152d4!important}
#iso_plane #layer_rooms [data-selected='goal']{fill:#ffe9d6!important;stroke:#c2410c!important}
#iso_plane .wall-int,#iso_plane .wall-ext{stroke:#9c8f76;stroke-width:1}
#iso_plane .door-gap{stroke:#c9a46a;stroke-width:3.2;stroke-linecap:butt}
#iso_plane .door-leaf{stroke:#5b5244;stroke-width:1.2}
#iso_plane .door-arc{stroke:#b3a68c;stroke-width:.8;stroke-dasharray:2 2}
#iso_plane .elev{fill:#e4e1fb;stroke:#4338ca;stroke-width:1.2}
#iso_plane .ent-acc,#iso_plane .ent-std,#iso_plane #layer_accessibility circle{display:none}
#iso_plane .stair-tread{stroke:#0f766e;stroke-width:1.1}
#iso_plane .obs-verified{fill:url(#hatch_red);fill-opacity:.85;stroke:#b91c1c;stroke-width:1.6}
#iso_plane .obs-pending{stroke:#b91c1c;stroke-width:1.4}
#iso_plane .obs-resolved{stroke:#9b917f}
.iso-shadow{fill:#3b3220;fill-opacity:.10}
.iso-slab-below{fill:#e6dcc8;fill-opacity:.55;stroke:#a89b80;stroke-width:1;stroke-dasharray:6 5;vector-effect:non-scaling-stroke}
.iso-slab-side.x{fill:#d6c9ae}.iso-slab-side.y{fill:#c3b493}
.iso-wall{stroke:none}.iso-wall.x{fill:#d8cdb6;fill-opacity:.34}.iso-wall.y{fill:#bfb196;fill-opacity:.40}
.iso-wall.ext.x{fill-opacity:.46}.iso-wall.ext.y{fill-opacity:.52}
.iso-wall-top{stroke:#3d382f;stroke-width:1.5;stroke-linecap:round;vector-effect:non-scaling-stroke}
.iso-wall-top.ext{stroke:#24211b;stroke-width:2.4}
.iso-shaft.elevator .l{fill:#8b84e8;fill-opacity:.55}.iso-shaft.elevator .r{fill:#6d64dc;fill-opacity:.6}.iso-shaft.elevator .t{fill:#c9c5f6;fill-opacity:.85;stroke:#4338ca;stroke-width:1.2;vector-effect:non-scaling-stroke}
.iso-shaft.stairs .l{fill:#5fb3a2;fill-opacity:.38}.iso-shaft.stairs .r{fill:#3d9886;fill-opacity:.42}.iso-shaft.stairs .t{fill:#bfe3da;fill-opacity:.55;stroke:#0f766e;stroke-width:1.2;vector-effect:non-scaling-stroke}
.iso-link{stroke-width:1.2;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}.iso-link.elevator{stroke:#4338ca;stroke-opacity:.6}.iso-link.stairs{stroke:#0f766e;stroke-opacity:.6}
`;
