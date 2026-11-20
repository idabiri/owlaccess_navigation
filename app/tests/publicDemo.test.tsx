// The public static demo (Vercel): no reports server. Reports and review decisions stay in this browser, the preloaded demo
// obstacles are the same for everyone, nothing calls /api, and the OpenStreetMap attribution is shown.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SiteForTests } from "../src/App";
import { EMPTY_TRIP, type TripPlan } from "../src/app/AppState";
import { sharedReportsEnabled } from "../src/reports/reportMode";
import { createReport, verifyReport, saveReports, snapToEdge } from "../src/reports/obstacleReports";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const go = (path: string) => window.history.replaceState(null, "", path);
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  cleanup(); go("/");
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true });
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("public static demo (jsdom, not a real browser)", () => {
  it("reports are shared only in local development (or when a deployment turns sharing on); the public build keeps them in the browser", () => {
    expect(sharedReportsEnabled({ DEV: true })).toBe(true);
    expect(sharedReportsEnabled({ DEV: false })).toBe(false);
    expect(sharedReportsEnabled({ DEV: false, VITE_SHARED_REPORTS: "false" })).toBe(false);
    expect(sharedReportsEnabled({ DEV: false, VITE_SHARED_REPORTS: "true" })).toBe(true);
  });

  it("/review: says decisions stay in this browser, lists the same preloaded demo obstacles for everyone, and never calls a server", async () => {
    go("/review"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(screen.getByTestId("local-only-note")).toHaveTextContent(/saved in this browser only/i);
    expect(screen.getByTestId("local-only-note")).toHaveTextContent(/other visitors don.t see them/i);
    const list = screen.getByRole("list", { name: "Preloaded demo obstacles" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(data.unified.obstacles.length);
    expect(list).toHaveTextContent(/OBS-001/);
    expect(within(list).getAllByText(/verified \(approved\)/)).toHaveLength(data.unified.obstacles.filter(o => o.status === "verified").length);
    expect(within(list).getAllByText(/Never blocks a route/)).toHaveLength(data.unified.obstacles.filter(o => o.status !== "verified").length);
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();                                          // no /api calls, no polling
  });

  it("route options use this browser's verified reports; a pending report there changes nothing", async () => {
    const trip: TripPlan = { ...EMPTY_TRIP, start: "room_105", goal: "room_113" };
    const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;               // corridor e_f1_051, on this route
    const pending = createReport(draft, "blocked_hallway", "Boxes across the hallway", { severity: "blocks_everyone" });
    saveReports([pending]);
    go("/suggestions"); const a = render(<SiteForTests data={data} trip={trip} />);
    const before = await screen.findByRole("list", { name: "Route options" });
    expect(before.textContent).not.toMatch(/Avoids .*verified by a reviewer/);
    a.unmount(); cleanup();
    saveReports([verifyReport(pending, "blocked_hallway", "blocks_everyone")]);
    go("/suggestions"); render(<SiteForTests data={data} trip={trip} />);
    const after = await screen.findByRole("list", { name: "Route options" });
    expect(after.textContent).toMatch(/Avoids .*verified by a reviewer/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("every page credits © OpenStreetMap contributors with a link to the attribution page", () => {
    render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    const link = screen.getAllByRole("link", { name: /© OpenStreetMap contributors/ })[0];
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  });
});
