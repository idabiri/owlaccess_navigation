import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteForTests } from "../src/App";
import { suggestRoutes } from "../src/routing/alternatives";
import { EMPTY_TRIP, type TripPlan } from "../src/app/AppState";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const go = (path: string) => window.history.replaceState(null, "", path);
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const nav = () => screen.getByRole("navigation", { name: "Main" });
beforeEach(() => { cleanup(); go("/"); });

describe("pages and navigation (jsdom, not a real browser)", () => {
  it("the landing page starts with the trip; 'More trip options' opens /plan", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} />);
    expect(h1()).toMatch(/Where are you headed/);
    expect(within(screen.getByRole("main")).getByRole("link", { name: /something in the way/i })).toHaveAttribute("href", "/report");
    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "More trip options" }));
    expect(window.location.pathname).toBe("/plan");
    expect(h1()).toBe("Plan an accessible route");
    expect(within(nav()).getByRole("link", { name: "Plan a route" })).toHaveAttribute("aria-current", "page");
  });
  it("Back returns to the previous page; unknown addresses show Not found", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} />);
    await user.click(within(nav()).getByRole("link", { name: "About the data" }));
    expect(h1()).toMatch(/What OwlAccess knows/);
    await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 20)); });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(h1()).toMatch(/Where are you headed/);
    cleanup(); go("/nowhere"); render(<SiteForTests data={data} />);
    expect(h1()).toBe("Page not found");
  });
  it("every main page renders inside the same shell", () => {
    for (const [path, title] of [["/plan", /Plan an accessible route/], ["/report", /Report an accessibility issue/], ["/review", /Review reports/], ["/navigate", /Navigate/], ["/about", /What OwlAccess knows/]] as const) {
      cleanup(); go(path); render(<SiteForTests data={data} />);
      expect(h1()).toMatch(title); expect(nav()).toBeInTheDocument(); expect(screen.getByRole("contentinfo")).toHaveTextContent(/not an official Kennesaw State University service/);
    }
  });
  it("the /review page opens the map view on the Reviewer tab; /report on the Report tab", () => {
    go("/review"); render(<SiteForTests data={data} />);
    expect(screen.getByRole("tab", { name: /^reviewer/i })).toHaveAttribute("aria-selected", "true");
    cleanup(); go("/report"); render(<SiteForTests data={data} />);
    expect(screen.getByRole("tab", { name: /^report$/i })).toHaveAttribute("aria-selected", "true");
  });
  it("the phone menu button opens and closes the site menu", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} />);
    const b = screen.getByRole("button", { name: /menu/i });
    expect(b).toHaveAttribute("aria-expanded", "false");
    await user.click(b); expect(b).toHaveAttribute("aria-expanded", "true");
  });
  it("/about shows counts computed from the data and labels synthetic, provisional and unknown data", () => {
    go("/about"); render(<SiteForTests data={data} />);
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(`${data.unified.edges.filter(e => e.domain === "outdoor").length} segments`);
    expect(main).toHaveTextContent(/everything inside is a generated demonstration layout/);
    expect(within(main).getAllByText("Synthetic").length).toBeGreaterThan(0);
    expect(within(main).getByRole("table")).toHaveTextContent(/provisional unverified/);
  });
});

describe("plan -> suggestions -> navigate (jsdom, not a real browser)", () => {
  it("planning needs a start and a destination", async () => {
    const user = userEvent.setup();
    go("/plan"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    await user.click(screen.getByRole("button", { name: "Show route options" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose both/);
    expect(window.location.pathname).toBe("/plan");
  });
  it("requirements are one choice, separate from preferences; wheelchair means step-free plus accessible-only links", async () => {
    const user = userEvent.setup();
    go("/plan"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    const req = screen.getByRole("region", { name: /accessibility requirements/i });
    expect(within(req).getByRole("radio", { name: /^walking/i })).toBeChecked();
    await user.click(within(req).getByRole("radio", { name: /^wheelchair/i }));
    expect(within(req).getByRole("radio", { name: /^wheelchair/i })).toBeChecked();
    expect(within(req).getByRole("radio", { name: /^wheelchair/i })).toHaveAccessibleName(/step-free/i);
    expect(within(req).getByRole("radio", { name: /^step-free/i })).toHaveAccessibleName(/elevators/i);
    expect(screen.getByRole("region", { name: /preferences/i })).toHaveTextContent(/Optional/);
    await user.selectOptions(screen.getByLabelText("Starting location"), "room_102");
    await user.selectOptions(screen.getByLabelText("Destination"), "room_302");
    await user.click(screen.getByRole("button", { name: "Show route options" }));
    expect(screen.getByTestId("trip-requirements")).toHaveTextContent("Wheelchair accessible");
  });
  it("the landing form plans a trip straight to the route options, with the chosen mobility", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    const form = screen.getByRole("form", { name: "Find a route" });
    await user.click(within(form).getByRole("button", { name: "Find routes" }));
    expect(within(form).getByRole("alert")).toHaveTextContent(/Choose where/);
    await user.selectOptions(within(form).getByLabelText("From"), "oe_ENT007");
    await user.selectOptions(within(form).getByLabelText("To"), "room_302");
    await user.click(within(form).getByRole("radio", { name: /^step-free/i }));
    await user.click(within(form).getByRole("button", { name: "Find routes" }));
    expect(window.location.pathname).toBe("/suggestions");
    expect(screen.getByRole("main")).toHaveTextContent("Academic Building Entrance");
    expect(screen.getByTestId("trip-requirements")).toHaveTextContent("Step-free");
  });
  it("plan a wheelchair trip, compare real options, choose one, and navigate with it", async () => {
    const user = userEvent.setup();
    go("/plan"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    await user.selectOptions(screen.getByLabelText("Starting location"), "room_102");
    await user.selectOptions(screen.getByLabelText("Destination"), "room_302");
    await user.click(screen.getByRole("radio", { name: /^wheelchair/i }));
    await user.click(screen.getByRole("button", { name: "Show route options" }));
    expect(window.location.pathname).toBe("/suggestions");
    const expected = suggestRoutes(data.unified, "room_102", "room_302", { wheelchair: true, avoidStairs: false, applyObstacles: true }).suggestions;
    const cards = within(await screen.findByRole("list", { name: "Route options" })).getAllByRole("listitem", { name: undefined }).filter(li => li.classList.contains("sugg-card"));
    expect(cards).toHaveLength(expected.length);
    expected.forEach((s, i) => {
      expect(within(cards[i]).getByTestId("sugg-distance")).toHaveTextContent(`${s.route.distanceM.toFixed(1)} m`);
      expect(cards[i]).toHaveTextContent(s.name);
    });
    expect(cards[0]).toHaveTextContent("Recommended");
    expect(within(cards[0]).getByRole("button", { name: /shown on map/i })).toHaveAttribute("aria-pressed", "true");
    // choose the other elevator, see it selected on the map, then navigate with it
    const other = cards.find(c => /Via Elevator/.test(c.textContent ?? ""))!;
    await user.click(within(other).getByRole("button", { name: /show on map/i }));
    expect(within(other).getByRole("button", { name: /shown on map/i })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll("[data-alt-route]").length).toBeGreaterThan(0);              // other options drawn faintly
    await user.click(within(other).getByRole("button", { name: /start navigation/i }));
    expect(window.location.pathname).toBe("/navigate");
    expect(screen.getByText(/Following: Via Elevator/)).toBeInTheDocument();
    const chosen = expected.find(s => s.strategy.kind === "other_vertical")!;
    expect(await screen.findByTestId("total-distance")).toHaveTextContent(`${chosen.route.distanceM.toFixed(1)} m`);
    expect(screen.getByRole("list", { name: /floor transitions/i })).toHaveTextContent(new RegExp(chosen.elevators[0], "i"));
  });
  it("no qualifying route: the suggestions page says so instead of offering one", async () => {
    const trip: TripPlan = { ...EMPTY_TRIP, start: "room_102", goal: "room_302", requirements: { wheelchair: true, stepFree: false, elevatorsOnly: false }, restrictions: { avoidVerifiedObstacles: true, scenario: "SCN-NO-ELEVATOR" } };
    go("/suggestions"); render(<SiteForTests data={data} trip={trip} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No accessible route meets your requirements/);
    expect(screen.queryByRole("list", { name: "Route options" })).toBeNull();
  });
  it("without a planned trip, /suggestions points back to planning", () => {
    go("/suggestions"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Plan a route" })).toBeInTheDocument();
  });
});
