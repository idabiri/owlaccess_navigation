// Stage 3: RULE-BASED (offline) suggestion for an obstacle report. Not a machine-learning model.
// It only SUGGESTS a category and severity from the words in the description. A person confirms them,
// and nothing here can verify a report or change a route.
import type { ReportCategory } from "./obstacleReports";

export const SEVERITIES = {
  blocks_everyone: "Blocks everyone",
  blocks_wheelchair: "Blocks wheelchair users",
  minor: "Minor (passable with care)",
  unclear: "Not sure",
} as const;
export type Severity = keyof typeof SEVERITIES;
export type Confidence = "high" | "medium" | "low";

export interface Suggestion {
  method: "rule-based"; version: 1;
  category: ReportCategory; severity: Severity; confidence: Confidence;
  matched: string[];                  // the words from the description (or the location) that drove the suggestion, shown as the reason
  safety_alert: boolean;              // fire / smoke / gas / injury words: tell the person to contact campus safety, not just file a report
}

const r = (patterns: string[]): RegExp[] => patterns.map(p => new RegExp(`\\b${p.replace(/ /g, "\\s+")}\\b`, "i"));

const CATEGORY_RULES: Record<Exclude<ReportCategory, "other">, RegExp[]> = {
  elevator_unavailable: r(["elevators?", "lifts?", "out of order", "out of service", "stuck between floors", "call button"]),
  construction_area: r(["construction", "renovation", "scaffold(?:ing)?", "workers?", "drilling", "repairs?", "cones?", "caution tape", "wet paint", "under maintenance"]),
  blocked_doorway: r(["doors?", "doorways?", "entrance", "exit", "jammed", "door opener", "automatic door", "push button", "threshold"]),
  blocked_hallway: r(["hallways?", "corridors?", "halls?", "passage(?:way)?", "carts?", "boxes", "furniture", "chairs?", "tables?", "crowd", "equipment", "trash", "bins?", "ladder", "spill(?:ed)?", "puddle"]),
};
// Location hint from where the report was placed (snapped segment type)
const EDGE_HINT: Record<string, ReportCategory> = { elevator_door: "elevator_unavailable", door: "blocked_doorway", entrance_threshold: "blocked_doorway", hallway: "blocked_hallway" };

const EVERYONE = r(["completely blocked", "fully blocked", "totally blocked", "blocked off", "can(?:no|')t (?:get|go) through", "cannot pass", "no way through", "impassable", "closed", "locked", "flooded", "sealed off"]);
const WHEELCHAIR = r(["narrow(?:ed|s)?", "partially blocked", "partly blocked", "half (?:of )?(?:the )?(?:hallway|corridor|door(?:way)?)", "squeeze", "steps?", "stairs?", "curb", "ramp", "lip", "too heavy", "heavy door", "door opener", "push button", "wheelchair", "walker", "out of order", "out of service", "not working", "broken"]);
const MINOR = r(["wet floor", "slippery", "small", "slight(?:ly)?", "minor", "a little", "sign", "loose mat", "easy to get around", "can get around"]);
const SAFETY = r(["fire", "smoke", "gas leak", "gas smell", "sparks?", "exposed wires?", "injur(?:y|ed)", "flood(?:ing|ed)?", "collapsed?"]);

/** the person's own words that each matching pattern found */
const hits = (rules: RegExp[], text: string) => rules.map(re => re.exec(text)?.[0]).filter((m): m is string => !!m);

export function classifyReport(description: string, edgeType?: string): Suggestion {
  const text = description.toLowerCase().replace(/\s+/g, " ");
  // category: most keyword hits wins; the location of the tap breaks ties and helps when the text says nothing
  const scores = (Object.keys(CATEGORY_RULES) as (keyof typeof CATEGORY_RULES)[]).map(c => ({ c, m: hits(CATEGORY_RULES[c], text) }));
  const hint = edgeType ? EDGE_HINT[edgeType] : undefined;
  scores.sort((a, b) => b.m.length - a.m.length || (b.c === hint ? 1 : 0) - (a.c === hint ? 1 : 0));
  const top = scores[0], tied = scores.filter(s => s.m.length === top.m.length).length > 1;
  const category: ReportCategory = top.m.length ? top.c : hint ?? "other";
  const matched = [...top.m];
  if (!top.m.length && hint) matched.push(`placed on a ${edgeType!.replace(/_/g, " ")}`);

  const ev = hits(EVERYONE, text), wc = hits(WHEELCHAIR, text), mi = hits(MINOR, text);
  let severity: Severity = ev.length ? "blocks_everyone" : wc.length ? "blocks_wheelchair" : mi.length ? "minor" : "unclear";
  if (category === "elevator_unavailable" && severity !== "blocks_everyone") severity = "blocks_wheelchair";   // an elevator out cuts off wheelchair users first
  if (category === "construction_area" && severity === "unclear") severity = "blocks_wheelchair";
  matched.push(...ev, ...(severity === "blocks_wheelchair" ? wc : []), ...(severity === "minor" ? mi : []));

  const strength = top.m.length + ev.length + wc.length + mi.length;
  const confidence: Confidence = !top.m.length || severity === "unclear" ? "low" : tied || strength < 3 ? "medium" : "high";
  return { method: "rule-based", version: 1, category, severity, confidence, matched: [...new Set(matched)].slice(0, 6), safety_alert: hits(SAFETY, text).length > 0 };
}
