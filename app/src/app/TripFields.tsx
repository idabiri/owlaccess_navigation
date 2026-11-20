// Shared trip inputs for the landing page and /plan: a place picker grouped the way a visitor thinks about places,
// and one "how do you get around?" choice that maps onto the trip's accessibility requirements.
import type { EndpointMeta } from "../routing/unifiedRouting";
import type { TripPlan } from "./AppState";

export function placeGroups(ep: EndpointMeta[], onlyFloor = "all"): [string, EndpointMeta[]][] {
  return [
    ["Outside: building entrances (locations not yet field-checked)", ep.filter(e => e.kind === "outdoor_entrance")],
    ["Academic Building: entrances, inside (synthetic plan)", ep.filter(e => e.kind === "building_entrance")],
    ...[1, 2, 3].filter(f => onlyFloor === "all" || onlyFloor === String(f))
      .map(f => [`Academic Building, floor ${f} rooms (synthetic plan)`, ep.filter(e => e.kind === "room" && e.floor_id === `BLD001_F${f}`)] as [string, EndpointMeta[]]),
  ];
}

export function PlaceSelect({ label, value, onChange, endpoints, hint }: { label: string; value: string; onChange: (id: string) => void; endpoints: EndpointMeta[]; hint?: string }) {
  return (
    <label className="field-lg place">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} required>
        <option value="">{hint ?? "Choose a place"}</option>
        {placeGroups(endpoints).map(([g, list]) => list.length > 0 && <optgroup key={g} label={g}>{list.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</optgroup>)}
      </select>
    </label>
  );
}

export type Mobility = "walking" | "step_free" | "wheelchair";
export const mobilityOf = (r: TripPlan["requirements"]): Mobility => (r.wheelchair ? "wheelchair" : r.stepFree || r.elevatorsOnly ? "step_free" : "walking");
export const requirementsFor = (m: Mobility): TripPlan["requirements"] =>
  m === "wheelchair" ? { wheelchair: true, stepFree: true, elevatorsOnly: true } : m === "step_free" ? { wheelchair: false, stepFree: true, elevatorsOnly: true } : { wheelchair: false, stepFree: false, elevatorsOnly: false };

const OPTIONS: { id: Mobility; title: string; text: string }[] = [
  { id: "walking", title: "Walking", text: "Stairs and steps are fine." },
  { id: "step_free", title: "Step-free", text: "No stairs or steps. Uses elevators between floors." },
  { id: "wheelchair", title: "Wheelchair", text: "Step-free, and only paths, doors and entrances marked accessible." },
];

/** One choice instead of three overlapping checkboxes. These are requirements: no route is offered that breaks them. */
export function MobilityChoice({ value, onChange, compact = false }: { value: Mobility; onChange: (m: Mobility) => void; compact?: boolean }) {
  return (
    <fieldset className={compact ? "mobility compact" : "mobility"}>
      <legend>How do you get around?</legend>
      <div className="mobility-options">
        {OPTIONS.map(o => (
          <label key={o.id} className="mob-opt">
            <input type="radio" name={compact ? "mobility-quick" : "mobility"} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span className="mob-icon" aria-hidden="true">{o.id === "walking" ? <WalkIcon /> : o.id === "step_free" ? <LiftIcon /> : <ChairIcon />}</span>
            <span className="mob-text"><b>{o.title}</b>{!compact && <small>{o.text}</small>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const svg = { viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const WalkIcon = () => <svg {...svg}><circle cx="17" cy="5.5" r="2.6" fill="currentColor" stroke="none" /><path d="M16 10 L13 18 L17 22 L18 29" /><path d="M13 18 L10 28" /><path d="M15 12 L20 16 L24 15" /><path d="M15 12 L10 15 L9 19" /></svg>;
const LiftIcon = () => <svg {...svg}><rect x="6" y="3" width="20" height="26" rx="3" /><path d="M16 3 V29" /><path d="M9 12 L11.5 9 L14 12" /><path d="M18 20 L20.5 23 L23 20" /></svg>;
const ChairIcon = () => <svg {...svg}><circle cx="15" cy="4.8" r="2.6" fill="currentColor" stroke="none" /><path d="M14 9 L13 18 L22 18 L26 26" /><path d="M10 14 a 8 8 0 1 0 11 10" /><path d="M13.5 13 L21 12.5" /></svg>;
