import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { classifyReport } from "../src/reports/classify";
import { createReport, snapToEdge, loadReports, STORAGE_KEY } from "../src/reports/obstacleReports";
import { route } from "../src/routing/unifiedRouting";
import { reportToObstacle } from "../src/reports/obstacleReports";
import { NavigationApp } from "../src/components/NavigationApp";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();

describe("rule-based classifier: suggestions", () => {
  it.each([
    ["The elevator is out of order, doors won't open", undefined, "elevator_unavailable", "blocks_wheelchair"],
    ["Cleaning cart blocking half the corridor, too narrow for my wheelchair", "hallway", "blocked_hallway", "blocks_wheelchair"],
    ["Hallway completely blocked by boxes and furniture", "hallway", "blocked_hallway", "blocks_everyone"],
    ["Door is locked", "door", "blocked_doorway", "blocks_everyone"],
    ["Automatic door opener push button broken", "door", "blocked_doorway", "blocks_wheelchair"],
    ["Construction workers and scaffolding in the lobby", undefined, "construction_area", "blocks_wheelchair"],
    ["Small wet floor sign, can get around it", "hallway", "blocked_hallway", "minor"],
  ])("%s", (text, edgeType, category, severity) => {
    const s = classifyReport(text, edgeType);
    expect(s.category).toBe(category);
    expect(s.severity).toBe(severity);
    expect(s.matched.length).toBeGreaterThan(0);
    expect(s.method).toBe("rule-based");
  });
  it("uses the tap location when the words say nothing, with low confidence", () => {
    const s = classifyReport("something is here", "elevator_door");
    expect(s).toMatchObject({ category: "elevator_unavailable", confidence: "low" });
    expect(s.matched[0]).toMatch(/elevator door/);
  });
  it("falls back to 'other' / 'unclear' with low confidence for text it does not understand", () => {
    expect(classifyReport("hmm not sure what this is")).toMatchObject({ category: "other", severity: "unclear", confidence: "low" });
  });
  it("raises a safety alert for danger words", () => {
    expect(classifyReport("I smell smoke near the stairs").safety_alert).toBe(true);
    expect(classifyReport("Boxes in the corridor").safety_alert).toBe(false);
  });
  it("reasons are the reporter's own words", () => {
    expect(classifyReport("CART blocking the Corridor").matched).toEqual(expect.arrayContaining(["cart", "corridor"]));
  });
});

describe("rule-based classifier: safety", () => {
  const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;   // corridor e_f1_051
  it("a suggestion has no status/verified fields and cannot make a report verified", () => {
    const s = classifyReport("Hallway completely blocked, cannot pass", "hallway");
    expect(s).not.toHaveProperty("status"); expect(s).not.toHaveProperty("verified");
    const evil = { ...s, status: "verified", verified: true } as unknown as typeof s;    // even a tampered suggestion
    const r = createReport(draft, s.category, "blocked", { severity: s.severity, suggestion: evil });
    expect(r.status).toBe("pending"); expect(r.verified).toBe(false);
  });
  it("a 'blocks everyone, high confidence' report still does not change any route", () => {
    const s = classifyReport("Hallway completely blocked, cannot pass, boxes everywhere", "hallway");
    expect(s).toMatchObject({ severity: "blocks_everyone", confidence: "high" });
    const ob = reportToObstacle(createReport(draft, s.category, "blocked", { severity: s.severity, suggestion: s }));
    const d2 = { ...data.unified, obstacles: [...data.unified.obstacles, ob] };
    const a = route(data.unified, "room_105", "room_113", { wheelchair: true }), b = route(d2, "room_105", "room_113", { wheelchair: true, obstacleIds: [ob.obstacle_id] });
    expect(a.found && b.found && a.links.join() === b.links.join()).toBe(true);
  });
  it("records whether the reporter accepted or changed the suggestion", () => {
    const s = classifyReport("Elevator out of service", "elevator_door");
    expect(createReport(draft, s.category, "x", { severity: s.severity, suggestion: s }).suggestion_accepted).toBe(true);
    expect(createReport(draft, "other", "x", { severity: s.severity, suggestion: s }).suggestion_accepted).toBe(false);
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}

describe("rule-based classifier: UI (jsdom, not a real browser)", () => {
  beforeEach(() => { cleanup(); Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true }); });
  it("shows a labelled suggestion as you type; 'Use suggestion' fills the choices; the saved report keeps the suggestion and stays pending", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} />);
    await user.click(within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: /floor 1/i }));
    const svg = document.querySelector<SVGSVGElement>("[data-testid=indoor-map] svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 1120, right: 680, bottom: 1120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    fireEvent.click(svg, { clientX: 275, clientY: 440.5 });
    const form = screen.getByRole("form", { name: /new obstacle report/i });
    expect(within(form).queryByLabelText(/suggested classification/i)).toBeNull();        // nothing until there is text
    await user.type(within(form).getByRole("textbox"), "Hallway completely blocked by boxes");
    const box = within(form).getByLabelText(/suggested classification/i);
    expect(box).toHaveTextContent(/rule-based/i); expect(box).toHaveTextContent(/Blocks everyone/);
    await user.click(within(box).getByRole("button", { name: /use suggestion/i }));
    expect((within(form).getByLabelText(/how bad/i) as HTMLSelectElement).value).toBe("blocks_everyone");
    await user.click(within(form).getByRole("button", { name: /submit report/i }));
    const [saved] = loadReports();
    expect(saved).toMatchObject({ status: "pending", verified: false, severity: "blocks_everyone", suggestion_accepted: true });
    expect(saved.suggestion?.method).toBe("rule-based");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    expect(screen.getByRole("list", { name: /pending obstacle reports/i })).toHaveTextContent(/accepted by reporter/);
  });
});
