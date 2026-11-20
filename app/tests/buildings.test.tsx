import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listBuildings } from "../src/buildings";
import { NavigationApp } from "../src/components/NavigationApp";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const tabs = () => within(screen.getByRole("tablist", { name: "Map view" })).getAllByRole("tab").map(t => t.textContent);
const title = () => screen.getByTestId("map-title").textContent;

describe("building list", () => {
  it("lists the three tracked buildings; only the Academic Building has (synthetic) floors", () => {
    const b = listBuildings(data);
    expect(b.map(x => x.id)).toEqual(["BLD001", "BLD002", "BLD003"]);   // indoor-mapped first, then by name
    expect(b[0]).toMatchObject({ id: "BLD001", shortName: "Academic Building", hasIndoor: true, floors: [1, 2, 3] });
    for (const x of b.slice(1)) expect(x).toMatchObject({ hasIndoor: false, floors: [] });
    expect(b.map(x => x.shortName)).toEqual(expect.arrayContaining(["Design 2 Building", "Engineering Technology Center"]));
  });
});

describe("building selector UI (jsdom, not a real browser)", () => {
  beforeEach(() => cleanup());
  it("defaults to the Academic Building with its floor tabs", () => {
    render(<NavigationApp data={data} />);
    expect((screen.getByRole("combobox", { name: "Building" }) as HTMLSelectElement).value).toBe("BLD001");
    expect(tabs()).toEqual(["Outdoor", "Floor 1", "Floor 2", "Floor 3"]);
  });
  it("an outdoor-only building: outdoor map, highlighted, honest note, and no floor tabs", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Building" }), "BLD002");
    expect(title()).toBe("Outdoor map");
    expect(tabs()).toEqual(["Outdoor"]);
    expect(screen.getByTestId("building-note")).toHaveTextContent(/Design 2 Building.*no indoor map/);
    expect(document.querySelector("[data-building-id=BLD002]")!.getAttribute("class")).toMatch(/bld-focus/);
    expect(document.querySelector("[data-building-id=BLD001]")!.getAttribute("class")).not.toMatch(/bld-focus/);
    expect(screen.getByRole("option", { name: /Engineering Technology Center — outdoor only/ })).toBeInTheDocument();
  });
  it("choosing the Academic Building opens floor 1", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Building" }), "BLD003");
    await user.selectOptions(screen.getByRole("combobox", { name: "Building" }), "BLD001");
    expect(title()).toBe("Indoor map – floor 1");
    expect(screen.queryByTestId("building-note")).toBeNull();
  });
  it("a route that goes indoors switches the selector back to the Academic Building", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "room_102", goal: "room_212" }} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Building" }), "BLD002");
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(title()).toBe("Indoor map – floor 1");
    expect((screen.getByRole("combobox", { name: "Building" }) as HTMLSelectElement).value).toBe("BLD001");
  });
});
