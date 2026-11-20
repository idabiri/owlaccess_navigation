import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { route, type UnifiedData } from "../src/routing/unifiedRouting";
import { createReport, snapToEdge, verifyReport, rejectReport, resolveReport, blockingObstacles, reportBlocks, loadReports, saveReports, STORAGE_KEY,
  type ObstacleReport } from "../src/reports/obstacleReports";
import { NavigationApp } from "../src/components/NavigationApp";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;           // corridor e_f1_051, on the 105 -> 113 route
const pending = () => createReport(draft, "blocked_hallway", "Boxes in the corridor");
/** route 105 -> 113 the way the app does it: verified reports become extra obstacles, selected by id */
const go = (reports: ObstacleReport[], wheelchair: boolean, applyObstacles = true) => {
  const extra = blockingObstacles(reports, wheelchair);
  const d: UnifiedData = { ...data.unified, obstacles: [...data.unified.obstacles, ...extra] };
  return route(d, "room_105", "room_113", { wheelchair, applyObstacles, obstacleIds: extra.map(o => o.obstacle_id) });
};
const base = { walk: go([], false), wheel: go([], true) };
const same = (a: ReturnType<typeof go>, b: ReturnType<typeof go>) => a.found && b.found && a.links.join() === b.links.join();

describe("review: state changes", () => {
  it("verify -> verified with the reviewer's category and severity; resolve -> resolved", () => {
    const v = verifyReport(pending(), "construction_area", "blocks_everyone", " checked ");
    expect(v).toMatchObject({ status: "verified", verified: true, review: { decision: "verified", category: "construction_area", severity: "blocks_everyone", note: "checked" } });
    const z = resolveReport(v);
    expect(z.status).toBe("resolved"); expect(typeof z.review!.resolved_at).toBe("string");
  });
  it("reject -> rejected, never verified", () => {
    expect(rejectReport(pending())).toMatchObject({ status: "rejected", verified: false, review: { decision: "rejected" } });
  });
  it("refuses impossible transitions and a missing severity", () => {
    const v = verifyReport(pending(), "blocked_hallway", "minor");
    expect(() => verifyReport(v, "blocked_hallway", "minor")).toThrow();
    expect(() => rejectReport(v)).toThrow();
    expect(() => resolveReport(pending())).toThrow();
    expect(() => verifyReport(pending(), "blocked_hallway", "unclear" as never)).toThrow();
  });
});

describe("review: what blocks, and for whom (the router itself is unchanged)", () => {
  it("baseline: 105 -> 113 is the short corridor route", () => {
    expect(base.walk.found && base.walk.distanceM).toBe(22);
    expect(base.wheel.found && base.wheel.distanceM).toBe(22);
  });
  it("pending, rejected and resolved reports never change a route", () => {
    for (const r of [pending(), rejectReport(pending()), resolveReport(verifyReport(pending(), "blocked_hallway", "blocks_everyone"))]) {
      expect(blockingObstacles([r], true)).toEqual([]);
      expect(same(go([r], false), base.walk)).toBe(true); expect(same(go([r], true), base.wheel)).toBe(true);
    }
  });
  it("verified 'blocks everyone' reroutes walking and wheelchair routes (22 m -> 55 m)", () => {
    const v = verifyReport(pending(), "blocked_hallway", "blocks_everyone");
    for (const wc of [false, true]) { const r = go([v], wc); expect(r.found && r.distanceM).toBe(55); expect(r.found && r.appliedObstacles).toEqual([v.report_id]); }
  });
  it("verified 'blocks wheelchair users' reroutes only wheelchair routes", () => {
    const v = verifyReport(pending(), "blocked_hallway", "blocks_wheelchair");
    expect(same(go([v], false), base.walk)).toBe(true);
    const w = go([v], true); expect(w.found && w.distanceM).toBe(55);
  });
  it("verified 'minor' changes no route", () => {
    const v = verifyReport(pending(), "blocked_hallway", "minor");
    expect(reportBlocks(v, true)).toBe(false); expect(same(go([v], true), base.wheel)).toBe(true);
  });
  it("'Avoid verified obstacles' off ignores verified reports too", () => {
    const v = verifyReport(pending(), "blocked_hallway", "blocks_everyone");
    expect(same(go([v], true, false), base.wheel)).toBe(true);
  });
});

describe("review: stored data is not trusted", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it("keeps consistent reviewed reports and drops forged ones", () => {
    const s = mem(), v = verifyReport(pending(), "blocked_hallway", "blocks_everyone"), z = resolveReport(verifyReport(pending(), "other", "minor")), x = rejectReport(pending());
    const forged = [
      { ...pending(), report_id: "F1", status: "verified", verified: true },                                    // verified with no review
      { ...v, report_id: "F2", verified: false },                                                                 // flag disagrees with status
      { ...v, report_id: "F3", review: { ...v.review!, severity: "unclear" } },                                  // reviewer must choose a severity
      { ...x, report_id: "F4", verified: true },                                                                  // rejected but "verified"
      { ...pending(), report_id: "F5", review: v.review },                                                        // pending with a review
    ];
    saveReports([v, z, x], s);
    s.setItem(STORAGE_KEY, JSON.stringify([...JSON.parse(s.getItem(STORAGE_KEY)!), ...forged]));
    expect(loadReports(s).map(r => r.report_id)).toEqual([v.report_id, z.report_id, x.report_id]);
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}

describe("review: UI (jsdom, not a real browser)", () => {
  beforeEach(() => { cleanup(); Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true }); });
  it("report -> review -> verify recalculates the route on screen; resolve restores it", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "room_105", goal: "room_113", mode: "wheelchair" }} />);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
    // report it
    const svg = document.querySelector<SVGSVGElement>("[data-testid=indoor-map] svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 1120, right: 680, bottom: 1120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    fireEvent.click(svg, { clientX: 275, clientY: 440.5 });
    const form = screen.getByRole("form", { name: /new obstacle report/i });
    await user.type(within(form).getByRole("textbox"), "Hallway completely blocked by boxes");
    await user.click(within(form).getByRole("button", { name: /submit report/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");          // pending: no change
    // review it
    expect(screen.queryByRole("button", { name: /^review /i })).toBeNull();             // review controls only in the Reviewer tab
    await user.click(screen.getByRole("tab", { name: /^reviewer/i }));                   // unified UI: was the "Reviewer mode" checkbox
    await user.click(screen.getByRole("button", { name: /^review /i }));
    const rf = screen.getByRole("form", { name: /^review /i });
    await user.selectOptions(within(rf).getByLabelText(/confirmed severity/i), "blocks_everyone");
    await user.click(within(rf).getByRole("button", { name: /verify obstacle/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("55.0 m");
    expect(screen.getByTestId("route-notice")).toHaveTextContent(/22\.0 m \/ 19 s → 55\.0 m \/ 48 s/);
    expect(screen.getByRole("list", { name: /verified obstacle reports/i }).children).toHaveLength(1);
    expect(document.querySelectorAll("#report_layer .report-dot.verified")).toHaveLength(1);
    expect(loadReports()[0]).toMatchObject({ status: "verified", verified: true });
    // obstacle cleared
    await user.click(screen.getByRole("button", { name: /resolved/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
    expect(screen.getByRole("list", { name: /closed obstacle reports/i })).toHaveTextContent(/Resolved/);
    expect(document.querySelectorAll("#report_layer .report-dot")).toHaveLength(0);
  });
  it("rejecting a report leaves the route alone and closes the report", async () => {
    saveReports([pending()]);
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "room_105", goal: "room_113" }} />);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    await user.click(screen.getByRole("tab", { name: /^reviewer/i }));                   // unified UI: was the "Reviewer mode" checkbox
    await user.click(screen.getByRole("button", { name: /^review /i }));
    await user.click(within(screen.getByRole("form", { name: /^review /i })).getByRole("button", { name: /reject/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
    expect(screen.getByTestId("route-notice")).toHaveTextContent(/no change/);
    expect(screen.getByRole("list", { name: /closed obstacle reports/i })).toHaveTextContent(/Rejected/);
  });
});
