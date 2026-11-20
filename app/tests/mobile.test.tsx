// Phone layout: plan -> route options (no map) -> Start navigation -> map + simulated position + steps -> back to planning.
// jsdom has no real screen, so a phone is simulated by answering the app's "(max-width: 900px)" media query with true.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteForTests } from "../src/App";
import { suggestRoutes } from "../src/routing/alternatives";
import { EMPTY_TRIP, type TripPlan } from "../src/app/AppState";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const go = (path: string) => window.history.replaceState(null, "", path);
const original = window.matchMedia;
const pretendScreen = (phone: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: phone && /max-width/.test(q), media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};
beforeEach(() => { cleanup(); go("/"); pretendScreen(true); });
afterEach(() => { window.matchMedia = original; });

const wheelchairTrip: TripPlan = { ...EMPTY_TRIP, start: "room_102", goal: "room_302", requirements: { wheelchair: true, stepFree: true, elevatorsOnly: true } };
const maps = () => document.querySelectorAll(".outdoor-svg, .indoor-svg").length;

describe("phone layout (simulated phone screen in jsdom, not a real browser)", () => {
  it("full flow: plan, compare without a map, confirm, navigate with map and steps, return to planning", async () => {
    const user = userEvent.setup();
    go("/plan"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(maps()).toBe(0);
    await user.selectOptions(screen.getByLabelText("Starting location"), "room_102");
    await user.selectOptions(screen.getByLabelText("Destination"), "room_302");
    await user.click(screen.getByRole("radio", { name: /^wheelchair/i }));
    await user.click(screen.getByRole("button", { name: "Show route options" }));

    // route options: no map, requirements + preferences visible, metrics on each card, a fixed Start navigation bar
    expect(window.location.pathname).toBe("/suggestions");
    const list = await screen.findByRole("list", { name: "Route options" });
    expect(maps()).toBe(0);
    expect(screen.queryByRole("region", { name: /map of the route options/i })).toBeNull();
    expect(screen.getByTestId("trip-requirements")).toHaveTextContent("Wheelchair accessible");
    expect(screen.getByTestId("trip-preferences")).toHaveTextContent(/Fastest/);
    const expected = suggestRoutes(data.unified, "room_102", "room_302", { wheelchair: true, avoidStairs: true, applyObstacles: true }).suggestions;
    const cards = within(list).getAllByRole("listitem").filter(li => li.classList.contains("sugg-card"));
    expect(cards).toHaveLength(expected.length);
    cards.forEach((c, i) => { expect(within(c).getByTestId("sugg-distance")).toHaveTextContent(`${expected[i].route.distanceM.toFixed(1)} m`); expect(within(c).getByTestId("sugg-time")).toBeInTheDocument(); });
    const bar = screen.getByRole("region", { name: "Selected route" });
    expect(bar).toHaveTextContent(expected[0].name);
    expect(bar).toHaveTextContent("No stairs");

    // pick the other elevator (the bar follows the selection), then confirm from the bar
    const other = cards.find(c => /Via Elevator/.test(c.textContent ?? ""))!;
    await user.click(within(other).getByRole("button", { name: "Select" }));
    expect(within(other).getByRole("button", { name: "Selected" })).toHaveAttribute("aria-pressed", "true");
    const chosen = expected.find(s => s.strategy.kind === "other_vertical")!;
    expect(bar).toHaveTextContent(chosen.name);
    expect(within(bar).getByTestId("start-bar-distance")).toHaveTextContent(`${chosen.route.distanceM.toFixed(0)} m`);
    await user.click(within(bar).getByRole("button", { name: /start navigation/i }));

    // navigation: the same engine's route, a map with the simulated position, and the step dock
    expect(window.location.pathname).toBe("/navigate");
    expect(await screen.findByTestId("total-distance")).toHaveTextContent(`${chosen.route.distanceM.toFixed(1)} m`);
    expect(maps()).toBe(1);
    expect(document.querySelector("[data-position=simulated]")).not.toBeNull();
    const dock = screen.getByRole("region", { name: "Current step" });
    expect(dock).toHaveTextContent(/Step 1 of \d+/);
    expect(dock).toHaveTextContent(/position simulated/);
    const first = screen.getByTestId("dock-step").textContent;
    await user.click(within(dock).getByRole("button", { name: "Next step" }));
    expect(dock).toHaveTextContent(/Step 2 of/);
    expect(screen.getByTestId("dock-step").textContent).not.toBe(first);
    expect(screen.getByTestId("current-step")).toHaveTextContent(screen.getByTestId("dock-step").textContent!);   // panel and dock agree
    expect(screen.getAllByRole("button", { name: "Next step" })).toHaveLength(1);                                   // the strip's copy is not duplicated on phones

    // back to the route options (still the same trip), then to a new plan
    await user.click(screen.getByRole("link", { name: "‹ Route options" }));
    expect(window.location.pathname).toBe("/suggestions");
    expect(await screen.findByRole("list", { name: "Route options" })).toBeInTheDocument();
    expect(maps()).toBe(0);
    expect(screen.getByRole("region", { name: "Selected route" })).toHaveTextContent(chosen.name);                 // the followed route is still selected
    await user.click(within(screen.getByRole("region", { name: "Selected route" })).getByRole("button", { name: /start navigation/i }));
    await user.click(screen.getByRole("link", { name: "New trip" }));
    expect(window.location.pathname).toBe("/plan");
    expect(screen.getByLabelText("Starting location")).toHaveValue("room_102");                                    // the plan is kept to edit
  });
  it("/navigate on a phone without a confirmed route shows no map, only the way back to planning", () => {
    go("/navigate"); render(<SiteForTests data={data} trip={wheelchairTrip} />);
    expect(maps()).toBe(0);
    expect(screen.getByRole("link", { name: "See route options" })).toBeInTheDocument();
    cleanup(); go("/navigate"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(maps()).toBe(0);
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Plan a route" })).toBeInTheDocument();
  });
  it("reporting still shows the map on a phone (only route planning hides it)", () => {
    go("/report"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(maps()).toBe(1);
  });
  it("desktop is unchanged: the options map and the map-based navigate view still appear", async () => {
    pretendScreen(false);
    go("/suggestions"); render(<SiteForTests data={data} trip={wheelchairTrip} />);
    expect(await screen.findByRole("region", { name: /map of the route options/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected route" })).toBeNull();
    cleanup(); go("/navigate"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(maps()).toBe(1);
    expect(screen.queryByRole("region", { name: "Current step" })).toBeNull();
  });
});
