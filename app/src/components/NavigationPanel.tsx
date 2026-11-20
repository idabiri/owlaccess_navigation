import type { EndpointMeta } from "../routing/unifiedRouting";

export interface NavState { start: string; goal: string; mode: "walking" | "wheelchair"; avoidStairs: boolean; avoidObstacles: boolean; scenario: string; pick: "start" | "goal" }
export interface NavigationPanelProps { state: NavState; endpoints: EndpointMeta[]; scenarios: { scenario_id: string; description?: string }[]; labelOf: (id: string) => string; onChange: (patch: Partial<NavState>) => void; onCalculate: () => void }

export function NavigationPanel({ state, endpoints, scenarios, labelOf, onChange, onCalculate }: NavigationPanelProps) {
  const groups: [string, EndpointMeta[]][] = [
    ["Outdoor entrances (provisional)", endpoints.filter(e => e.kind === "outdoor_entrance")],
    ["Building entrances (synthetic indoor)", endpoints.filter(e => e.kind === "building_entrance")],
    ...[1, 2, 3].map(f => [`Floor ${f} rooms (synthetic)`, endpoints.filter(e => e.kind === "room" && e.floor_id === `BLD001_F${f}`)] as [string, EndpointMeta[]]),
  ];
  const known = new Set(endpoints.map(e => e.id));
  const select = (id: "start" | "goal", label: string) => (
    <label className="field"><span>{label}</span>
      <select value={state[id]} onChange={e => onChange({ [id]: e.target.value })} aria-label={label}>
        <option value="">Choose&hellip;</option>
        {state[id] && !known.has(state[id]) && <option value={state[id]}>{labelOf(state[id])}</option>}
        {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(e => <option key={e.id} value={e.id}>{e.label}{e.kind === "room" ? ` (${e.id})` : ""}</option>)}</optgroup>)}
      </select>
    </label>
  );
  const wheel = state.mode === "wheelchair";
  return (
    <form className="panel" onSubmit={ev => { ev.preventDefault(); onCalculate(); }} aria-label="Navigation controls">
      <h2>Navigation</h2>
      {select("start", "Starting location")}{select("goal", "Destination")}
      <fieldset className="field"><legend>Click on a map sets the</legend>
        <label><input type="radio" name="pick" checked={state.pick === "start"} onChange={() => onChange({ pick: "start" })} /> starting location</label>
        <label><input type="radio" name="pick" checked={state.pick === "goal"} onChange={() => onChange({ pick: "goal" })} /> destination</label>
      </fieldset>
      <fieldset className="field"><legend>Mode</legend>
        <label><input type="radio" name="mode" checked={!wheel} onChange={() => onChange({ mode: "walking" })} /> Walking</label>
        <label><input type="radio" name="mode" checked={wheel} onChange={() => onChange({ mode: "wheelchair" })} /> Wheelchair</label>
      </fieldset>
      <label className="check"><input type="checkbox" checked={wheel || state.avoidStairs} disabled={wheel} onChange={e => onChange({ avoidStairs: e.target.checked })} /> Avoid stairs{wheel ? " (always on in wheelchair mode)" : ""}</label>
      <label className="check"><input type="checkbox" checked={state.avoidObstacles} onChange={e => onChange({ avoidObstacles: e.target.checked })} /> Avoid verified obstacles</label>
      <label className="field"><span>Demo obstacle scenario (synthetic)</span>
        <select value={state.scenario} onChange={e => onChange({ scenario: e.target.value })} aria-label="Demo obstacle scenario">
          <option value="">None</option>{scenarios.filter(s => s.scenario_id !== "SCN-NORMAL").map(s => <option key={s.scenario_id} value={s.scenario_id}>{s.scenario_id}{s.description ? ` – ${s.description}` : ""}</option>)}
        </select>
      </label>
      <button type="submit" className="primary" disabled={!state.start || !state.goal}>Calculate route</button>
    </form>
  );
}
