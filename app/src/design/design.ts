// OwlAccess look and layout, read from design.json. The It design studio edits design.json; Vite reloads it into the
// running app, so every change is made in the real project. Values are checked here so a bad edit can't break the app.
import raw from "./design.json";

export interface Design {
  accent: string; routeColor: string; pendingColor: string; verifiedColor: string;
  panelSide: "left" | "right"; panelWidth: number; density: "comfortable" | "compact"; radius: number; fontScale: number;
  mapContrast: "standard" | "high"; reportCards: "detailed" | "compact"; mobileMapHeight: number;
  /** multi-page site */
  heroLayout: "split" | "centered"; navStyle: "bar" | "pills"; cardStyle: "elevated" | "outlined";
  planLayout: "single" | "two-column"; suggestionCards: "detailed" | "compact"; suggestionsMap: "right" | "left";
}
export const DEFAULT_DESIGN: Design = {
  accent: "#1d4ed8", routeColor: "#16a34a", pendingColor: "#ea580c", verifiedColor: "#b91c1c",
  panelSide: "left", panelWidth: 380, density: "comfortable", radius: 10, fontScale: 1,
  mapContrast: "standard", reportCards: "detailed", mobileMapHeight: 55,
  heroLayout: "split", navStyle: "bar", cardStyle: "elevated",
  planLayout: "single", suggestionCards: "detailed", suggestionsMap: "right",
};
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const one = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function normalizeDesign(v: Partial<Record<keyof Design, unknown>> = {}): Design {
  const d = DEFAULT_DESIGN;
  return {
    accent: hex(v.accent, d.accent), routeColor: hex(v.routeColor, d.routeColor), pendingColor: hex(v.pendingColor, d.pendingColor), verifiedColor: hex(v.verifiedColor, d.verifiedColor),
    panelSide: one(v.panelSide, ["left", "right"] as const, d.panelSide), panelWidth: num(v.panelWidth, 300, 520, d.panelWidth),
    density: one(v.density, ["comfortable", "compact"] as const, d.density), radius: num(v.radius, 0, 20, d.radius), fontScale: num(v.fontScale, 0.85, 1.3, d.fontScale),
    mapContrast: one(v.mapContrast, ["standard", "high"] as const, d.mapContrast), reportCards: one(v.reportCards, ["detailed", "compact"] as const, d.reportCards),
    mobileMapHeight: num(v.mobileMapHeight, 35, 75, d.mobileMapHeight),
    heroLayout: one(v.heroLayout, ["split", "centered"] as const, d.heroLayout), navStyle: one(v.navStyle, ["bar", "pills"] as const, d.navStyle),
    cardStyle: one(v.cardStyle, ["elevated", "outlined"] as const, d.cardStyle),
    planLayout: one(v.planLayout, ["single", "two-column"] as const, d.planLayout),
    suggestionCards: one(v.suggestionCards, ["detailed", "compact"] as const, d.suggestionCards),
    suggestionsMap: one(v.suggestionsMap, ["right", "left"] as const, d.suggestionsMap),
  };
}
export const design: Design = normalizeDesign(raw as Partial<Record<keyof Design, unknown>>);

/** CSS custom properties for the app root */
export function designStyle(d: Design): Record<string, string> {
  return {
    "--acc": d.accent, "--route": d.routeColor, "--pending": d.pendingColor, "--verified": d.verifiedColor,
    "--panel-w": `${d.panelWidth}px`, "--radius": `${d.radius}px`, "--font-scale": String(d.fontScale), "--mobile-map-h": `${d.mobileMapHeight}vh`,
  };
}
