import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { route, type RouteFound } from "../src/routing/unifiedRouting";
import { buildPlan } from "../src/routing/instructions";
import { buildSteps } from "../src/routing/steps";
import { NavigationApp } from "../src/components/NavigationApp";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const d = data.unified;
const stepsFor = (a: string, b: string, wheelchair = false) => {
  const label = (id: string) => d.endpoints_meta.find(m => m.id === id)?.label ?? `Outdoor path point (${id})`;   // as the app labels them
  const r = route(d, a, b, { wheelchair }) as RouteFound; const plan = buildPlan(d, r, label(a), label(b));
  return { r, plan, steps: buildSteps(d, r, plan) };
};

describe("navigation steps are built from the existing route and instructions", () => {
  for (const [a, b, wc] of [["room_102", "room_302", true], ["on_9e09c97887", "room_212", false], ["room_111", "room_117", false], ["oe_ENT007", "room_302", true]] as const)
    it(`${a} -> ${b}${wc ? " (wheelchair)" : ""}: one step per instruction, covering the whole route in order`, () => {
      const { r, plan, steps } = stepsFor(a, b, wc);
      expect(steps.map(s => s.ins)).toEqual(plan.instructions);                     // the same directions, none invented
      expect(steps[0].fromNodeIndex).toBe(0); expect(steps.at(-1)!.toNodeIndex).toBe(r.nodes.length - 1);
      steps.slice(1).forEach((s, i) => expect(s.fromNodeIndex).toBe(steps[i].toNodeIndex));   // no gaps, no overlaps
      steps.forEach(s => expect(s.nodeIds).toEqual(r.nodes.slice(s.fromNodeIndex, s.toNodeIndex + 1)));
      steps.slice(1).forEach((s, i) => expect(s.distanceBeforeM).toBeGreaterThanOrEqual(steps[i].distanceBeforeM));
      expect(steps.at(-1)!.distanceBeforeM).toBeLessThanOrEqual(r.distanceM + 0.1);
      if (wc) { expect(steps.some(s => s.ins.kind === "stairs")).toBe(false); expect(JSON.stringify(steps.map(s => [s.ins.text, s.warnings]))).not.toMatch(/stair/i); }
    });
  it("elevator steps are marked step-free and carry the availability warning; narrow corridors are flagged on their step", () => {
    const wc = stepsFor("room_102", "room_302", true).steps;
    const elev = wc.filter(s => s.ins.kind === "elevator");
    expect(elev.length).toBeGreaterThan(0);
    for (const s of elev) { expect(s.stepFree).toBe(true); expect(s.warnings).toContain("Elevator availability is not verified"); }
    const narrow = stepsFor("room_102", "room_115").steps.filter(s => s.warnings.some(w => /narrow/.test(w)));   // this route uses a narrow corridor
    expect(narrow.length).toBeGreaterThan(0);
  });
});

describe("turn wording", () => {
  it("slight turns say 'Slightly turn left/right' (never 'Bear'), with the same turn thresholds", () => {
    const texts = d.endpoints_meta.flatMap(a => ["room_302", "room_117", "oe_ENT007"].flatMap(b => {
      if (a.id === b) return [];
      const r = route(d, a.id, b); return r.found ? buildPlan(d, r).instructions.map(i => i.text) : [];
    }));
    expect(texts.some(t => /\bBear\b/i.test(t))).toBe(false);
    const slight = texts.filter(t => /^Slightly turn (left|right) and walk \d+ m\.$/.test(t));
    expect(slight.length).toBeGreaterThan(0);                                                    // the slight-turn case still occurs
  });
});

describe("step-by-step navigation view (jsdom, not a real browser)", () => {
  beforeEach(() => cleanup());
  it("Next/Previous and clicking a step keep the list, the strip, the floor and the simulated marker in sync", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "room_102", goal: "room_302", mode: "wheelchair" }} />);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    const { steps } = stepsFor("room_102", "room_302", true);
    const list = () => screen.getByRole("list", { name: /turn-by-turn/i });
    const current = () => screen.getByTestId("current-step");
    expect(current()).toHaveTextContent(steps[0].ins.text);
    expect(screen.getByText(new RegExp(`Step 1 of ${steps.length}`), { selector: "p.muted" })).toBeInTheDocument();
    expect(document.querySelector("#route_layer [data-position=simulated]")).not.toBeNull();       // simulated marker, labelled as such
    expect(screen.getByText(/simulated/i, { selector: ".sim-note b" })).toBeInTheDocument();
    // Next step (panel)
    await user.click(screen.getByRole("button", { name: /^next step ›$/i }));
    expect(current()).toHaveTextContent(steps[1].ins.text);
    expect(within(list()).getAllByRole("listitem")[0]).toHaveAttribute("data-state", "done");
    expect(within(list()).getAllByRole("listitem")[1]).toHaveAttribute("data-state", "on");
    expect(document.querySelector("#route_layer [data-active-step]")).not.toBeNull();
    // click the second elevator step: the map moves to the floor it starts on, then Next goes up a floor
    const lastElev = steps.map(s => s.ins.kind).lastIndexOf("elevator");
    await user.click(within(list()).getAllByRole("button")[lastElev]);
    expect(current()).toHaveTextContent(/Take elevator/);
    expect(screen.getByTestId("map-title")).toHaveTextContent(`floor ${steps[lastElev].floor}`);
    await user.click(screen.getByRole("button", { name: "Next step" }));                              // the strip's control
    expect(screen.getByTestId("map-title")).toHaveTextContent(`floor ${steps[lastElev + 1].floor}`);
    expect(within(list()).getAllByRole("button")[lastElev + 1]).toHaveAttribute("aria-current", "step");
    // Previous step returns
    await user.click(screen.getByRole("button", { name: /^‹ previous step$/i }));
    expect(current()).toHaveTextContent(steps[lastElev].ins.text);
  });
  it("outdoor steps show the simulated position on the outdoor map", async () => {
    const user = userEvent.setup();
    render(<NavigationApp data={data} initial={{ start: "on_9e09c97887", goal: "room_212" }} />);
    await user.click(screen.getByRole("button", { name: /calculate route/i }));
    expect(screen.getByTestId("map-title")).toHaveTextContent("Outdoor map");
    expect(document.querySelector(".outdoor-svg [data-position=simulated]")).not.toBeNull();
    expect(screen.getByTestId("current-step")).toHaveTextContent("Outdoors");
  });
});
