// Isometric (3D-style) view of the indoor floors: display only. Routing coordinates and results must not change, the drawn
// geometry must be kept, door gaps must stay open, and a tap must map back to the right plan point.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildIsoSvg, makeProjection, pathPolylines, wallSegments, ISO } from "../src/components/isoView";
import { IndoorMap } from "../src/components/IndoorMap";
import { route, type UNode } from "../src/routing/unifiedRouting";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const nodes = new Map<string, UNode>(data.unified.nodes.map(n => [n.node_id, n]));
const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}
beforeEach(() => {
  cleanup();
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
});
afterEach(() => vi.unstubAllGlobals());

describe("isometric floor view (display only)", () => {
  it("projection and its inverse round-trip exactly", () => {
    const P = makeProjection(123.4, 56.7);
    for (const [x, y] of [[0, 0], [275, 440.5], [680, 1120], [154, 963]]) {
      const [X, Y] = P.project(x, y); const [x2, y2] = P.unproject(X, Y);
      expect(x2).toBeCloseTo(x, 9); expect(y2).toBeCloseTo(y, 9);
    }
    expect(P.project(10, 10, ISO.wallM * ISO.unitsPerM)[1]).toBeCloseTo(P.project(10, 10)[1] - 30, 9);   // height goes straight up
  });

  it("all three floors use the same projection, keep every room, door, stair and elevator, and leave the route layer upright", () => {
    const floors = [1, 2, 3].map(f => ({ f, src: data.svgs[f], iso: buildIsoSvg(data.svgs[f], { floor: f, floorsBelow: f - 1 }) }));
    const ref = floors[0].iso.project(275, 440.5);
    for (const { f, src, iso } of floors) {
      expect(iso.project(275, 440.5)).toEqual(ref);                                  // consistent perspective on every floor
      const a = parse(src), b = parse(iso.svg);
      for (const sel of ["[id^='room_']", "[id^='door_']", "[id^='stairwell_']", "[id^='elevator_']", "[id^='hallway_']", "[id^='obstacle_']"])
        expect(b.querySelectorAll(sel).length, `floor ${f} ${sel}`).toBe(a.querySelectorAll(sel).length);
      expect(b.querySelector("#iso_plane #room_" + `${f}02`)).not.toBeNull();        // floor shapes are inside the projected group
      expect(b.querySelector("#iso_plane #route_layer")).toBeNull();                 // the route is drawn upright, on top
      expect(b.documentElement.lastElementChild?.id).toBe("iso_labels");               // labels are drawn last, upright, by the map
      expect(b.querySelectorAll("#iso_plane text").length).toBe(0);                  // no skewed text left on the floor
      expect(iso.rooms.length).toBe(a.querySelectorAll("#layer_rooms [id^='room_']").length);
      expect(iso.rooms.every(r => /^\d{3}$/.test(r.number) && r.name.length > 0)).toBe(true);
      expect(iso.features.filter(x => x.kind === "elevator").map(x => x.label)).toEqual(["Elevator 1", "Elevator 2"]);
      expect(iso.features.filter(x => x.kind === "stairs").every(x => /not step-free/.test(x.detail))).toBe(true);
      expect(b.querySelectorAll(".iso-slab-below").length).toBe(f - 1);              // floors below, 4 m apart (assumed)
      expect(iso.svg).toMatch(/SYNTHETIC/);
      expect(iso.svg).toMatch(/walls 3 m high, floors 4 m apart/);
    }
  });

  it("walls are raised only where walls are drawn, with every drawn door gap left open", () => {
    const src = parse(data.svgs[1]);
    const outlines = [...src.querySelectorAll("#layer_walls_interior path, #layer_walls_exterior path")].flatMap(p => pathPolylines(p.getAttribute("d")!));
    const gaps = [...src.querySelectorAll("line.door-gap")].map(l => ["x1", "y1", "x2", "y2"].map(a => +l.getAttribute(a)!) as [number, number, number, number]);
    const segs = wallSegments(outlines, gaps);
    expect(segs.length).toBeGreaterThan(50);
    const near = (px: number, py: number, s: number[]) => {                             // distance from a point to a wall segment
      const [ax, ay, bx, by] = s, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    };
    for (const [x1, y1, x2, y2] of gaps) expect(segs.some(s => near((x1 + x2) / 2, (y1 + y2) / 2, s) < 0.5)).toBe(false);
    const iso = buildIsoSvg(data.svgs[1], { floor: 1, floorsBelow: 0 });
    expect(iso.wallCount).toBe(segs.length); expect(iso.doorGapCount).toBe(gaps.length);
  });

  it("the route, simulated position and pins are drawn at the projected routing coordinates; the route itself is unchanged", () => {
    const r = route(data.unified, "room_102", "room_113", {}); if (!r.found) throw new Error(r.reason);
    const before = JSON.stringify(r);
    render(<IndoorMap floor={1} svgText={data.svgs[1]} nodes={nodes} routeNodeIds={r.nodes} positionNodeId={r.nodes[2]} endpointNodeIds={{ start: r.nodes[0], goal: r.nodes[r.nodes.length - 1] }} />);
    const host = screen.getByTestId("indoor-map").querySelector(".indoor-svg")!;
    expect(host.getAttribute("data-view")).toBe("isometric");
    const iso = buildIsoSvg(data.svgs[1], { floor: 1, floorsBelow: 0, maxBelow: 2 });
    const want = r.nodes.map(id => nodes.get(id)!).filter(n => n.floor_id === "BLD001_F1").map(n => iso.project(n.x!, n.y!));
    const got = host.querySelector("#route_layer [data-route]")!.getAttribute("points")!.split(" ").map(q => q.split(",").map(Number));
    expect(got.length).toBe(want.length);
    got.forEach((q, i) => { expect(q[0]).toBeCloseTo(want[i][0], 1); expect(q[1]).toBeCloseTo(want[i][1], 1); });
    const me = nodes.get(r.nodes[2])!, [mx, my] = iso.project(me.x!, me.y!);
    const t = host.querySelector("[data-position='simulated']")!.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
    expect(Number(t[1])).toBeCloseTo(mx, 1); expect(Number(t[2])).toBeCloseTo(my, 1);
    expect(JSON.stringify(route(data.unified, "room_102", "room_113", {}))).toBe(before);
    expect(nodes.get(r.nodes[2])!.x).toBe(me.x);                                    // node coordinates untouched
  });

  it("in 3D, a tap while reporting maps back to the plan point; switching to the 2D plan is remembered", async () => {
    const user = userEvent.setup(), onReportPoint = vi.fn();
    render(<IndoorMap floor={1} svgText={data.svgs[1]} nodes={nodes} reportMode onReportPoint={onReportPoint} />);
    const host = screen.getByTestId("indoor-map").querySelector(".indoor-svg")!;
    const svg = host.querySelector("svg")!;
    const [, , vw, vh] = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const iso = buildIsoSvg(data.svgs[1], { floor: 1, floorsBelow: 0, maxBelow: 2 });
    const [X, Y] = iso.project(275, 440.5);
    fireEvent.click(svg, { clientX: X, clientY: Y });
    expect(onReportPoint).toHaveBeenCalledTimes(1);
    const [, px, py] = onReportPoint.mock.calls[0];
    expect(px).toBeCloseTo(275, 6); expect(py).toBeCloseTo(440.5, 6);
    await user.click(screen.getByRole("button", { name: "2D plan" }));
    const flat = screen.getByTestId("indoor-map").querySelector(".indoor-svg")!;
    expect(flat.getAttribute("data-view")).toBe("plan");
    expect(flat.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 680 1120");
    expect(localStorage.getItem("owlaccess.indoor-view")).toBe("plan");
  });

  it("camera: zoom in, zoom out, reset and keyboard all move the view; the drawing and the data stay the same", async () => {
    const user = userEvent.setup();
    render(<IndoorMap floor={1} svgText={data.svgs[1]} nodes={nodes} floorCount={3} />);
    const svg = () => screen.getByTestId("indoor-map").querySelector(".iso-canvas svg")!;
    const vb = () => svg().getAttribute("viewBox")!.split(/\s+/).map(Number);
    const fit = vb();
    expect(screen.getByRole("button", { name: "Zoom out of floor plan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zoom in on floor plan" }));
    expect(vb()[2]).toBeLessThan(fit[2]);
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(vb()).toEqual(fit);
    const canvas = screen.getByRole("group", { name: /Floor 1 of the Academic Building, 3D view/ });
    canvas.focus(); await user.keyboard("+");
    expect(vb()[2]).toBeLessThan(fit[2]);
    await user.keyboard("{ArrowRight}");
    expect(vb()[0]).toBeGreaterThan(fit[0]);
    await user.keyboard("0");
    expect(vb()).toEqual(fit);
  });

  it("labels: room numbers in pills, features as named chips; a floor change on the route gets its own chip, and Start gives way to You", () => {
    const r = route(data.unified, "room_102", "room_302", { wheelchair: true }); if (!r.found) throw new Error(r.reason);
    render(<IndoorMap floor={1} svgText={data.svgs[1]} nodes={nodes} floorCount={3} routeNodeIds={r.nodes} positionNodeId={r.nodes[0]}
      endpointNodeIds={{ start: r.nodes[0], goal: r.nodes[r.nodes.length - 1] }} goalRoomId="room_302" startRoomId="room_102" />);
    const host = screen.getByTestId("indoor-map").querySelector(".iso-canvas")!;
    const nums = [...host.querySelectorAll(".iso-room-lbl .num")].map(t => t.textContent);
    expect(nums).toContain("102");                                                   // the start room's label is always shown
    expect(host.querySelector(".iso-room-lbl.start")).not.toBeNull();
    expect([...host.querySelectorAll(".iso-transition text")].map(t => t.textContent).join(" ")).toMatch(/Elevator up to Floor 2/);
    expect(host.querySelector("[data-pin='start'] .chip")).toBeNull();                 // "You" stands on the start: one chip, not two
    expect(host.querySelector("[data-position='simulated'] .chip text")!.textContent).toBe("You (simulated)");
    expect(host.querySelectorAll(".iso-feature").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/Synthetic plan/);
    expect(document.body.textContent).toMatch(/walls are drawn 3 m high and floors 4 m apart/i);
  });
});
