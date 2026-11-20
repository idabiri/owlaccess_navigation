import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { normalizeDesign, DEFAULT_DESIGN, design } from "../src/design/design";
import raw from "../src/design/design.json";
import { SiteForTests } from "../src/App";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();

describe("design.json (edited by the It design studio)", () => {
  it("the file in the project is complete and valid", () => {
    expect(Object.keys(raw).sort()).toEqual(Object.keys(DEFAULT_DESIGN).sort());
    expect(normalizeDesign(raw as never)).toEqual(design);
  });
  it("bad values from an edit fall back to safe defaults instead of breaking the app", () => {
    const d = normalizeDesign({ accent: "red; background:url(x)", panelWidth: 99999, heroLayout: "giant", planLayout: "two-column", suggestionsMap: "left", suggestionCards: 3 } as never);
    expect(d.accent).toBe(DEFAULT_DESIGN.accent);
    expect(d.panelWidth).toBe(520);
    expect(d.heroLayout).toBe(DEFAULT_DESIGN.heroLayout);
    expect(d.planLayout).toBe("two-column"); expect(d.suggestionsMap).toBe("left"); expect(d.suggestionCards).toBe("detailed");
  });
  it("the site carries the layout choices as classes and the colours as CSS variables", () => {
    cleanup(); window.history.replaceState(null, "", "/");
    render(<SiteForTests data={data} />);
    const site = document.querySelector(".site") as HTMLElement;
    for (const c of [`hero-${design.heroLayout}`, `nav-${design.navStyle}`, `cards-${design.cardStyle}`, `plan-${design.planLayout}`, `sugg-${design.suggestionCards}`, `suggmap-${design.suggestionsMap}`])
      expect(site.classList.contains(c)).toBe(true);
    expect(site.style.getPropertyValue("--acc")).toBe(design.accent);
  });
});
beforeEach(() => cleanup());
