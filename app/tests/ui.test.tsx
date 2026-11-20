import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationApp } from "../src/components/NavigationApp";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const setup = async (initial: any = {}) => { cleanup(); const user = userEvent.setup(); render(<NavigationApp data={data} initial={initial} />); return user; };
const mapTab = (n: RegExp) => within(screen.getByRole("tablist", { name: "Map view" })).getByRole("tab", { name: n });
const title = () => screen.getByTestId("map-title").textContent;

describe("NavigationApp component behaviour (jsdom, not a real browser)", () => {
  it("shows the synthetic-data banner and starts on the outdoor map", async () => {
    await setup();
    expect(screen.getByRole("note")).toHaveTextContent(/synthetic/i);
    expect(title()).toBe("Outdoor map");
    expect(screen.getByRole("button", { name: /calculate route/i })).toBeDisabled();
  });
  it("calculates an outdoor->indoor route, shows results, and switches map outdoor -> floor 1 -> floor 2", async () => {
    const user = await setup({ start: "on_9e09c97887", goal: "room_212" });
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByTestId("total-distance")).toHaveTextContent(/m$/);
    expect(screen.getByTestId("total-time")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /turn-by-turn/i }).children.length).toBeGreaterThan(2);
    expect(title()).toBe("Outdoor map");
    expect(screen.getByTestId("segment-label")).toHaveTextContent(/outdoors/);
    await user.click(screen.getByRole("button", { name: "Next »" }));   // exact: "Next step" buttons exist too (step-by-step view)
    expect(title()).toBe("Indoor map – floor 1");
    expect(screen.getByText(/Current floor/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next »" }));   // exact: "Next step" buttons exist too (step-by-step view)
    expect(title()).toBe("Indoor map – floor 2");
    expect(screen.getByRole("list", { name: /floor transitions/i })).toBeInTheDocument();
  });
  it("route polyline is drawn into #route_layer on the active floor", async () => {
    const user = await setup({ start: "room_102", goal: "room_212" });
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(title()).toBe("Indoor map – floor 1");
    expect(document.querySelector("#route_layer polyline")).not.toBeNull();
  });
  it("floor tabs switch the indoor map manually", async () => {
    const user = await setup();
    await user.click(mapTab(/floor 3/i));
    expect(title()).toBe("Indoor map – floor 3");
    expect(document.querySelector("#room_301")).not.toBeNull();
    await user.click(mapTab(/floor 1/i));
    expect(title()).toBe("Indoor map – floor 1");
    expect(document.querySelector("#room_101")).not.toBeNull();
  });
  it("clicking a room on the indoor map selects it as the destination (and as start when asked)", async () => {
    const user = await setup();
    await user.click(mapTab(/floor 1/i));
    const room = document.querySelector("#room_102")!;
    fireEvent.click(room);
    expect((screen.getByLabelText("Destination") as HTMLSelectElement).value).toBe("room_102");
    await user.click(screen.getByLabelText(/starting location$/i, { selector: "input" }));
    fireEvent.click(document.querySelector("#room_101")!);
    expect((screen.getByLabelText("Starting location") as HTMLSelectElement).value).toBe("room_101");
  });
  it("wheelchair mode: Avoid stairs is forced on and route uses the elevator", async () => {
    const user = await setup({ start: "room_102", goal: "room_302" });
    await user.click(screen.getByRole("radio", { name: /wheelchair/i }));
    expect(screen.getByRole("checkbox", { name: /avoid stairs/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByRole("list", { name: /floor transitions/i })).toHaveTextContent(/elevator/i);
    expect(screen.getByRole("list", { name: /turn-by-turn/i })).not.toHaveTextContent(/stair/i);
  });
  it("shows a clear NO_ACCESSIBLE_ROUTE message when both elevators are out (verified obstacles on)", async () => {
    const user = await setup({ start: "room_102", goal: "room_302", mode: "wheelchair", scenario: "SCN-NO-ELEVATOR" });
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    const a = screen.getByRole("alert");
    expect(a).toHaveTextContent(/No accessible route found/);
    expect(a.querySelector("[data-reason]")!.getAttribute("data-reason")).toBe("NO_ACCESSIBLE_ROUTE");
  });
  it("'Avoid verified obstacles' off ignores the scenario (route found again)", async () => {
    const user = await setup({ start: "room_102", goal: "room_302", mode: "wheelchair", scenario: "SCN-NO-ELEVATOR", avoidObstacles: false });
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("total-distance")).toBeInTheDocument();
  });
  it("lists accessibility limitations, including synthetic / unverified caveats", async () => {
    const user = await setup({ start: "on_9e09c97887", goal: "room_101" });
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    const w = screen.getByRole("heading", { name: /accessibility limitations/i }).nextElementSibling as HTMLElement;
    expect(within(w).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(w.textContent).toMatch(/synthetic|unverified|not verified|provisional/i);
  });
});
