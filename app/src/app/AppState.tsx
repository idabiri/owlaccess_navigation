// What every page shares: the map and routing data (loaded once), the shared report store, and the trip being planned.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { AppData } from "../data";
import type { ReportStore } from "../reports/reportStore";
import type { Strategy } from "../routing/alternatives";

/** The trip the user is planning: mandatory accessibility requirements are kept apart from optional preferences. */
export interface TripPlan {
  start: string; goal: string;
  requirements: { wheelchair: boolean; stepFree: boolean; elevatorsOnly: boolean };
  preferences: { priority: "fastest" | "shortest" | "fewest_turns"; avoidNarrow: boolean };
  restrictions: { avoidVerifiedObstacles: boolean; scenario: string };
  /** the suggestion chosen on /suggestions, reproduced on /navigate */
  chosen?: { strategy: Strategy; name: string } | null;
}
export const EMPTY_TRIP: TripPlan = {
  start: "", goal: "",
  requirements: { wheelchair: false, stepFree: false, elevatorsOnly: false },
  preferences: { priority: "fastest", avoidNarrow: false },
  restrictions: { avoidVerifiedObstacles: true, scenario: "" },
  chosen: null,
};

interface AppStateValue { data: AppData; store?: ReportStore; trip: TripPlan; setTrip: (t: TripPlan) => void }
const Ctx = createContext<AppStateValue | null>(null);

const KEY = "owlaccess.trip.v1";
function loadTrip(): TripPlan {
  try { const t = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); if (t && typeof t.start === "string") return { ...EMPTY_TRIP, ...t }; } catch { /* unavailable */ }
  return EMPTY_TRIP;
}

export function AppStateProvider({ data, store, initialTrip, children }: { data: AppData; store?: ReportStore; initialTrip?: TripPlan; children: ReactNode }) {
  const [trip, setTripState] = useState<TripPlan>(() => initialTrip ?? loadTrip());
  const setTrip = (t: TripPlan) => { setTripState(t); try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch { /* unavailable: kept in memory */ } };
  return <Ctx.Provider value={{ data, store, trip, setTrip }}>{children}</Ctx.Provider>;
}
export function useAppState(): AppStateValue {
  const v = useContext(Ctx); if (!v) throw new Error("useAppState outside AppStateProvider"); return v;
}
