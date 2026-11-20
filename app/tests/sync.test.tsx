import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationApp } from "../src/components/NavigationApp";
import { createReport, snapToEdge, verifyReport, rejectReport, resolveReport, type ObstacleReport } from "../src/reports/obstacleReports";
import { StoreError, type ReportStore, type ReportsSnapshot, type ReviewRequest } from "../src/reports/reportStore";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;           // corridor e_f1_051, on the 105 -> 113 route

/** an in-memory stand-in for the laptop's dev server; `remote` changes the reports as another device would */
function fakeStore(initial: ObstacleReport[] = []) {
  let reports = initial, revision = 1, listener: ((s: ReportsSnapshot) => void) | null = null;
  const snap = () => ({ revision, reports });
  const apply = (id: string, req: ReviewRequest) => {
    reports = reports.map(r => r.report_id !== id ? r : req.action === "verify" ? verifyReport(r, req.category, req.severity, req.note)
      : req.action === "reject" ? rejectReport(r, req.note) : resolveReport(r, req.note)); revision++; return snap();
  };
  const store: ReportStore & { remote: (id: string, req: ReviewRequest) => void; failNext: boolean } = {
    failNext: false,
    load: vi.fn(async () => snap()),
    add: vi.fn(async (r: ObstacleReport) => { if (store.failNext) { store.failNext = false; throw new StoreError(0, "Can't reach the laptop."); } reports = [...reports, r]; revision++; return snap(); }),
    review: vi.fn(async (id: string, req: ReviewRequest) => apply(id, req)),
    clear: vi.fn(async () => { reports = []; revision++; return snap(); }),
    reviewerUrls: async () => ["http://192.168.1.20:5173/review"],
    watch: (onChange) => { listener = onChange; return () => { listener = null; }; },
    remote: (id, req) => { const s = apply(id, req); listener?.(s); },
  };
  return store;
}
const pending = () => createReport(draft, "blocked_hallway", "Cart in the corridor", { severity: "blocks_wheelchair" });

describe("laptop app with the shared store (jsdom, not a real browser)", () => {
  beforeEach(() => cleanup());
  it("a verification made on the phone recalculates the laptop's route; resolving it restores the route", async () => {
    const r = pending(), store = fakeStore([r]), user = userEvent.setup();
    render(<NavigationApp data={data} reportStore={store} initial={{ start: "room_105", goal: "room_113", mode: "wheelchair" }} />);
    await act(async () => undefined);                                              // the shared reports have loaded
    expect(store.load).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
    expect(screen.getByRole("tab", { name: /^reviewer \(1\)/i })).toBeInTheDocument();      // unified UI: the pending count is on the Reviewer tab
    await act(async () => store.remote(r.report_id, { action: "verify", category: "blocked_hallway", severity: "blocks_everyone" }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("55.0 m");
    expect(screen.getByTestId("route-notice")).toHaveTextContent(/a review on another device: 22\.0 m \/ 19 s → 55\.0 m \/ 48 s/);
    await act(async () => store.remote(r.report_id, { action: "resolve" }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
  });
  it("a rejection on the phone updates the list but never changes the route", async () => {
    const r = pending(), store = fakeStore([r]), user = userEvent.setup();
    render(<NavigationApp data={data} reportStore={store} initial={{ start: "room_105", goal: "room_113", mode: "wheelchair" }} />);
    await act(async () => undefined);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    await act(async () => store.remote(r.report_id, { action: "reject" }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent("22.0 m");
    expect(screen.queryByTestId("route-notice")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^reviewer/i }));                        // unified UI: the lists live in the Reviewer tab
    expect(screen.getByRole("list", { name: /closed obstacle reports/i })).toHaveTextContent(/Rejected/);
  });
  it("new reports are sent to the shared store; if the laptop can't be reached, the error shows and the text is kept", async () => {
    const store = fakeStore(), user = userEvent.setup();
    render(<NavigationApp data={data} reportStore={store} />);
    await user.click(within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: /floor 1/i }));
    const svg = document.querySelector<SVGSVGElement>("[data-testid=indoor-map] svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 1120, right: 680, bottom: 1120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await user.click(screen.getByRole("button", { name: "Report an obstacle" }));
    fireEvent.click(svg, { clientX: 275, clientY: 440.5 });
    const form = screen.getByRole("form", { name: /new obstacle report/i });
    await user.type(within(form).getByRole("textbox"), "Boxes in the corridor");
    store.failNext = true;
    await user.click(within(form).getByRole("button", { name: /submit report/i }));
    expect(await screen.findByTestId("sync-error")).toHaveTextContent(/Can't reach the laptop/);
    expect(within(screen.getByRole("form", { name: /new obstacle report/i })).getByRole("textbox")).toHaveValue("Boxes in the corridor");
    await user.click(within(screen.getByRole("form", { name: /new obstacle report/i })).getByRole("button", { name: /submit report/i }));
    expect(await screen.findByRole("list", { name: /pending obstacle reports/i })).toHaveTextContent(/Boxes in the corridor/);
    expect(store.add).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("sync-error")).toBeNull();
  });
});

// "/review" is now the same app with the Reviewer tab open (App.tsx passes initialPanel="review", allowClear={false})
const reviewLink = (store: ReportStore) => <NavigationApp data={data} reportStore={store} initialPanel="review" allowClear={false} />;

describe("phone reviewer /review, inside the unified app (jsdom, not a real browser)", () => {
  beforeEach(() => cleanup());
  it("lists pending reports and verifies one through the shared store with the reviewer's severity", async () => {
    const r = pending(), store = fakeStore([r]), user = userEvent.setup();
    render(reviewLink(store));
    expect(await screen.findByText(/Pending review \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^reviewer \(1\)/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: /outdoor campus map/i })).toBeInTheDocument();          // the map stays on screen while reviewing
    expect(screen.queryByRole("button", { name: /clear demo reports/i })).toBeNull();                 // the phone cannot wipe the demo
    await user.click(screen.getByRole("button", { name: `Review ${r.report_id}` }));
    const f = screen.getByRole("form", { name: `Review ${r.report_id}` });
    await user.selectOptions(within(f).getByLabelText(/confirmed severity/i), "blocks_everyone");
    await user.click(within(f).getByRole("button", { name: /verify obstacle/i }));
    expect(store.review).toHaveBeenCalledWith(r.report_id, expect.objectContaining({ action: "verify", category: "blocked_hallway", severity: "blocks_everyone" }));
    expect(await screen.findByTestId("route-notice")).toHaveTextContent(/verified\. New routes take this into account/);
    expect(screen.getByRole("list", { name: /verified obstacle reports/i }).children).toHaveLength(1);
  });
  it("rejecting on the phone sends a reject and closes the report", async () => {
    const r = pending(), store = fakeStore([r]), user = userEvent.setup();
    render(reviewLink(store));
    await user.click(await screen.findByRole("button", { name: `Review ${r.report_id}` }));
    await user.click(within(screen.getByRole("form", { name: `Review ${r.report_id}` })).getByRole("button", { name: /reject/i }));
    expect(store.review).toHaveBeenCalledWith(r.report_id, expect.objectContaining({ action: "reject" }));
    expect(await screen.findByRole("list", { name: /closed obstacle reports/i })).toHaveTextContent(/Rejected/);
  });
  it("public site: when the server asks for the reviewer passcode, a passcode form appears and the passcode is kept for the tab", async () => {
    const r = pending(), store = fakeStore([r]), user = userEvent.setup();
    store.review = vi.fn(async () => { throw new StoreError(401, "Reviewer passcode required.", true); });
    store.setReviewerPasscode = vi.fn();
    render(reviewLink(store));
    await user.click(await screen.findByRole("button", { name: `Review ${r.report_id}` }));
    await user.click(within(screen.getByRole("form", { name: `Review ${r.report_id}` })).getByRole("button", { name: /reject/i }));
    const f = await screen.findByRole("form", { name: /reviewer passcode/i });
    await user.type(within(f).getByLabelText(/reviewer passcode/i), "owl-2026");
    await user.click(within(f).getByRole("button", { name: /save passcode/i }));
    expect(store.setReviewerPasscode).toHaveBeenCalledWith("owl-2026");
    expect(screen.queryByRole("form", { name: /reviewer passcode/i })).toBeNull();
    expect(screen.getByTestId("route-notice")).toHaveTextContent(/passcode saved/i);
  });
  it("shows a clear message when the laptop cannot be reached", async () => {
    const store = fakeStore(); store.load = vi.fn(async () => { throw new StoreError(0, "Can't reach the laptop. Check that the dev server is running and that this device is on the same Wi-Fi."); });
    render(reviewLink(store));
    expect(await screen.findByRole("alert")).toHaveTextContent(/same Wi-Fi/);
  });
});
