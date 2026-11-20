import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationApp } from "../src/components/NavigationApp";
import { listReportPlaces, draftFromPlace, createReport, isReport, verifyReport, blockingObstacles } from "../src/reports/obstacleReports";
import { route } from "../src/routing/unifiedRouting";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const edge = (id: string) => data.unified.edges.find(e => e.edge_id === id)!;
const DEMO = "e_f1_051";                               // the corridor on the 105 -> 113 demo route

describe("location list (no pointer needed)", () => {
  it("offers every reportable segment of each floor, named in words, and nothing from other floors or room interiors", () => {
    for (const f of ["BLD001_F1", "BLD001_F2", "BLD001_F3"]) {
      const places = listReportPlaces(data.unified, f);
      expect(places.length).toBeGreaterThan(40);
      for (const p of places) {
        const e = edge(p.edge_id);
        expect(e.floor_id).toBe(f); expect(e.vertical).toBe(false); expect(e.edge_type).not.toBe("room_interior");
        expect(p.label).not.toMatch(/n_f\d|undefined|null/);                              // no internal ids leak into the names
      }
      expect(new Set(places.map(p => p.label)).size).toBe(places.length);                // every name is distinct
    }
  });
  it("names the demo corridor, doorways, elevator doors and entrances", () => {
    const labels = listReportPlaces(data.unified, "BLD001_F1").map(p => p.label);
    expect(labels).toEqual(expect.arrayContaining(["Hallway 5: junction J2 – outside Elevator Lobby 105", "Doorway of Classroom 111",
      "Elevator 1 door (Elevator Lobby 105)", "Entrance 2 threshold", "Entrance 4 (steps) threshold"]));
  });
  it("a place chosen from the list makes a normal report on that exact segment, which blocks only once verified", () => {
    const d = draftFromPlace(data.unified, "BLD001_F1", DEMO)!;
    expect(d).toMatchObject({ affected_edge_id: DEMO, snap_distance_m: 0, chosen_from_list: true });
    const r = createReport(d, "blocked_hallway", "Boxes");
    expect(isReport(r)).toBe(true); expect(blockingObstacles([r], true)).toEqual([]);
    const v = verifyReport(r, "blocked_hallway", "blocks_everyone"), extra = blockingObstacles([v], true);
    const res = route({ ...data.unified, obstacles: [...data.unified.obstacles, ...extra] }, "room_105", "room_113", { wheelchair: true, obstacleIds: extra.map(o => o.obstacle_id) });
    expect(res.found && res.distanceM).toBe(55);
    expect(draftFromPlace(data.unified, "BLD001_F2", DEMO)).toBeNull();                  // not a place on floor 2
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}

describe("reporting with the keyboard only (jsdom, not a real browser)", () => {
  beforeEach(() => { cleanup(); Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true }); });
  it("Report an obstacle -> choose from the list -> focus lands in the description -> submit, all with keys", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} />);
    await user.click(within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: /floor 1/i }));
    screen.getByRole("button", { name: "Report an obstacle" }).focus();
    await user.keyboard("{Enter}");
    const picker = screen.getByRole("form", { name: /choose the obstacle location from a list/i });
    const select = within(picker).getByRole("combobox");
    await user.selectOptions(select, DEMO);
    within(picker).getByRole("button", { name: "Use this location" }).focus();
    await user.keyboard("{Enter}");
    const form = screen.getByRole("form", { name: /new obstacle report/i });
    const box = within(form).getByRole("textbox");
    expect(document.activeElement).toBe(box);                                               // focus moved into the form
    expect(box).toHaveAccessibleDescription(/Floor 1, Hallway 5: junction J2 – outside Elevator Lobby 105 \(chosen from the list\)/);
    await user.keyboard("Furniture blocking the corridor");
    within(form).getByRole("button", { name: /submit report/i }).focus();
    await user.keyboard("{Enter}");
    const list = screen.getByRole("list", { name: /pending obstacle reports/i });
    expect(list).toHaveTextContent(/Hallway 5: junction J2 – outside Elevator Lobby 105/);
    expect(JSON.parse(localStorage.getItem("ksu-nav.obstacle-reports.v1")!)[0]).toMatchObject({ affected_edge_id: DEMO, status: "pending" });
  });
  it("the list is only offered while reporting, and Cancel reporting removes it", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} />);
    await user.click(within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: /floor 2/i }));
    expect(screen.queryByRole("form", { name: /choose the obstacle location/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    expect(screen.getByRole("form", { name: /choose the obstacle location/i })).toHaveTextContent(/on Floor 2/);
    await user.click(screen.getByRole("button", { name: "Cancel reporting" }));
    expect(screen.queryByRole("form", { name: /choose the obstacle location/i })).toBeNull();
  });
});
