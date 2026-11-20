import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationApp } from "../src/components/NavigationApp";
import { route } from "../src/routing/unifiedRouting";
import { snapToEdge, createReport, reportToObstacle, loadReports, saveReports, STORAGE_KEY, MAX_DESCRIPTION, type ReportDraft } from "../src/reports/obstacleReports";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const node = (id: string) => data.unified.nodes.find(n => n.node_id === id)!;
const edge = (id: string) => data.unified.edges.find(e => e.edge_id === id)!;
/** midpoint of an indoor edge, in floor-SVG units */
const mid = (id: string): [number, number] => { const e = edge(id), a = node(e.from_node), b = node(e.to_node); return [(a.x! + b.x!) / 2, (a.y! + b.y!) / 2]; };
const HALL = "e_f1_051";                       // the corridor the verified demo obstacle OBS-001 blocks

describe("obstacle reports: model", () => {
  it("snaps a tap to the nearest walkable segment on that floor", () => {
    const [x, y] = mid(HALL);
    const d = snapToEdge(data.unified, "BLD001_F1", x + 3, y)!;   // 0.3 m off the corridor centre line
    expect(d.affected_edge_id).toBe(HALL);
    expect(d.snap_distance_m).toBeLessThanOrEqual(0.3);
    expect(d.location_label).toMatch(/^Hallway \d+$/);
  });
  it("refuses a tap that is far from every walkway", () => {
    expect(snapToEdge(data.unified, "BLD001_F1", 2, 2)).toBeNull();
  });
  it("never snaps to another floor or to a vertical (elevator / stair) link", () => {
    const [x, y] = mid(HALL);
    const d = snapToEdge(data.unified, "BLD001_F2", x, y);
    if (d) { expect(edge(d.affected_edge_id).floor_id).toBe("BLD001_F2"); expect(edge(d.affected_edge_id).vertical).toBe(false); }
  });
  it("creates reports as pending and unverified, with a required, length-limited description", () => {
    const d = snapToEdge(data.unified, "BLD001_F1", ...mid(HALL))!;
    const r = createReport(d, "blocked_hallway", "  Cart in the corridor  ");
    expect(r).toMatchObject({ status: "pending", verified: false, source: "user_report", affected_edge_id: HALL, description: "Cart in the corridor" });
    expect(() => createReport(d, "other", "   ")).toThrow();
    expect(createReport(d, "other", "x".repeat(500)).description.length).toBe(MAX_DESCRIPTION);
  });
});

describe("obstacle reports: storage", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it("round-trips through storage", () => {
    const s = mem(), r = createReport(snapToEdge(data.unified, "BLD001_F1", ...mid(HALL))!, "blocked_hallway", "cart");
    expect(saveReports([r], s)).toBe(true);
    expect(loadReports(s)).toEqual([r]);
  });
  it("drops malformed entries and anything not pending/unverified (stored data is never trusted)", () => {
    const s = mem(), r = createReport(snapToEdge(data.unified, "BLD001_F1", ...mid(HALL))!, "blocked_hallway", "cart");
    s.setItem(STORAGE_KEY, JSON.stringify([r, { ...r, report_id: "X", status: "verified", verified: true }, { junk: 1 }, null]));
    expect(loadReports(s).map(x => x.report_id)).toEqual([r.report_id]);
    s.setItem(STORAGE_KEY, "{not json"); expect(loadReports(s)).toEqual([]);
  });
  it("reports failure instead of throwing when storage is blocked", () => {
    expect(saveReports([], { setItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(loadReports({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
  });
});

describe("obstacle reports: routing safety", () => {
  it("a pending report never changes a route, even if handed to the router; the same obstacle verified would", () => {
    const d = snapToEdge(data.unified, "BLD001_F1", ...mid(HALL)) as ReportDraft;
    const ob = reportToObstacle(createReport(d, "blocked_hallway", "cart"));
    const withReport = { ...data.unified, obstacles: [...data.unified.obstacles, ob] };
    for (const wheelchair of [false, true]) {
      const base = route(data.unified, "room_105", "room_113", { wheelchair });
      const pending = route(withReport, "room_105", "room_113", { wheelchair, obstacleIds: [ob.obstacle_id] });
      expect(base.found && pending.found).toBe(true);
      if (base.found && pending.found) { expect(pending.links).toEqual(base.links); expect(pending.appliedObstacles).toEqual([]); }
      // control: the very same edge, verified, does reroute (so the test above is meaningful)
      const verifiedData = { ...data.unified, obstacles: [...data.unified.obstacles, { ...ob, status: "verified" as const, verified: true }] };
      const verified = route(verifiedData, "room_105", "room_113", { wheelchair, obstacleIds: [ob.obstacle_id] });
      expect(verified.found && base.found && verified.links.join() !== base.links.join()).toBe(true);
    }
  });
});

// Node 26 ships an experimental global localStorage that is undefined without --localstorage-file and hides jsdom's.
// Give these tests a plain in-memory Storage so the browser behaviour is exercised.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}

describe("obstacle reports: UI (jsdom, not a real browser)", () => {
  beforeEach(() => { cleanup(); Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true }); });
  const openFloor1 = async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "room_105", goal: "room_113" }} />);
    await user.click(within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: /floor 1/i }));
    const svg = document.querySelector<SVGSVGElement>("[data-testid=indoor-map] svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 1120, right: 680, bottom: 1120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { user, svg };
  };
  it("report flow: toggle, tap the corridor, describe, submit -> listed as pending, saved, route unchanged", async () => {
    const { user, svg } = await openFloor1();
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    const before = screen.getByTestId("total-distance").textContent;
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    const [x, y] = mid(HALL);
    fireEvent.click(svg, { clientX: x, clientY: y });
    const form = screen.getByRole("form", { name: /new obstacle report/i });
    expect(form).toHaveTextContent(/Floor 1, Hallway \d+/);
    await user.type(within(form).getByRole("textbox"), "Cleaning cart blocking the corridor");
    await user.click(within(form).getByRole("button", { name: /submit report/i }));
    const list = screen.getByRole("list", { name: /pending obstacle reports/i });
    expect(list.children).toHaveLength(1);
    expect(list).toHaveTextContent(/Pending/); expect(list).toHaveTextContent(/Cleaning cart/);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    expect(document.querySelectorAll("#report_layer .report-dot.pending")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByTestId("total-distance").textContent).toBe(before);
  });
  it("a tap far from any walkway shows an error and no form", async () => {
    const { user, svg } = await openFloor1();
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    fireEvent.click(svg, { clientX: 2, clientY: 2 });
    expect(screen.getByRole("alert")).toHaveTextContent(/Tap closer to a walkway/);
    expect(screen.queryByRole("form", { name: /new obstacle report/i })).toBeNull();
  });
  it("while not reporting, clicking a room still chooses it", async () => {
    await openFloor1();
    fireEvent.click(document.querySelector("#room_102")!);
    expect((screen.getByLabelText("Destination") as HTMLSelectElement).value).toBe("room_102");
  });
});
