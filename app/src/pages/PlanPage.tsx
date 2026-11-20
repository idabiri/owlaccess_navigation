import { useMemo, useState } from "react";
import { useAppState, type TripPlan } from "../app/AppState";
import { useRouter } from "../app/router";
import { listBuildings } from "../buildings";
import { dataFacts } from "../app/dataFacts";
import type { EndpointMeta } from "../routing/unifiedRouting";

/** /plan: where to, what you need (mandatory requirements), what you would like (optional preferences), and what to avoid. */
export function PlanPage() {
  const { data, trip, setTrip } = useAppState();
  const { navigate } = useRouter();
  const [t, setT] = useState<TripPlan>(trip);
  const [floor, setFloor] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const facts = dataFacts(data);
  const buildings = listBuildings(data);
  const ep = data.unified.endpoints_meta;
  const groups = (onlyFloor: string): [string, EndpointMeta[]][] => [
    ["Outdoor entrances (provisional)", ep.filter(e => e.kind === "outdoor_entrance")],
    ["Building entrances (synthetic indoor)", ep.filter(e => e.kind === "building_entrance")],
    ...[1, 2, 3].filter(f => onlyFloor === "all" || onlyFloor === String(f))
      .map(f => [`Academic Building, floor ${f} (synthetic)`, ep.filter(e => e.kind === "room" && e.floor_id === `BLD001_F${f}`)] as [string, EndpointMeta[]]),
  ];
  const destGroups = useMemo(() => groups(floor), [floor, data]);
  const req = t.requirements, wc = req.wheelchair;
  const patch = (p: Partial<TripPlan>) => setT(s => ({ ...s, ...p }));
  const select = (id: "start" | "goal", label: string, gs: [string, EndpointMeta[]][]) => (
    <label className="field-lg"><span>{label}</span>
      <select value={t[id]} onChange={e => patch({ [id]: e.target.value })} required>
        <option value="">Choose&hellip;</option>
        {gs.map(([g, list]) => list.length > 0 && <optgroup key={g} label={g}>{list.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</optgroup>)}
      </select>
    </label>
  );
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!t.start || !t.goal) return setError("Choose both a starting location and a destination.");
    if (t.start === t.goal) return setError("The starting location and the destination are the same.");
    setError(null); setTrip({ ...t, chosen: null }); navigate("/suggestions");
  };

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Step 1 of 3 &middot; Plan</p>
        <h1>Plan an accessible route</h1>
        <p className="lede-sm">Requirements are rules every route must follow. Preferences only change which route is recommended.</p>
      </div>
      <form className="plan-form" onSubmit={submit} aria-label="Plan a route" noValidate>
        <section className="card" aria-labelledby="where-h">
          <h2 id="where-h"><span className="step-num">1</span> Where</h2>
          <div className="grid-2">
            {select("start", "Starting location", groups("all"))}
            <div className="field-lg">
              <span>Destination building and floor</span>
              <div className="row-2">
                <select aria-label="Destination building" value="BLD001" onChange={() => undefined}>
                  {buildings.map(b => <option key={b.id} value={b.id} disabled={!b.hasIndoor}>{b.shortName}{b.hasIndoor ? "" : " (outdoor only, no indoor map)"}</option>)}
                </select>
                <select aria-label="Destination floor" value={floor} onChange={e => setFloor(e.target.value)}>
                  <option value="all">All floors</option>{[1, 2, 3].map(f => <option key={f} value={String(f)}>Floor {f}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="grid-2">
            {select("goal", "Destination", destGroups)}
            <div className="swap-cell"><button type="button" className="btn btn-ghost" onClick={() => patch({ start: t.goal, goal: t.start })}>⇅ Swap start and destination</button></div>
          </div>
          <p className="hint">Only the Academic Building has an indoor map (synthetic). Design 2 and the Engineering Technology Center are outdoor-only.</p>
        </section>

        <section className="card req" aria-labelledby="req-h">
          <h2 id="req-h"><span className="step-num">2</span> Accessibility requirements <span className="tag tag-must">Must have</span></h2>
          <label className="check-lg"><input type="checkbox" checked={wc} onChange={e => patch({ requirements: { ...req, wheelchair: e.target.checked } })} />
            <span><b>Wheelchair accessible</b><small>No steps or stairs, and only paths, doors and entrances marked accessible in the data.</small></span></label>
          <label className="check-lg"><input type="checkbox" checked={wc || req.stepFree} disabled={wc} onChange={e => patch({ requirements: { ...req, stepFree: e.target.checked } })} />
            <span><b>Step-free</b><small>No stairs or steps anywhere on the route.{wc ? " Included in wheelchair accessible." : ""}</small></span></label>
          <label className="check-lg"><input type="checkbox" checked={wc || req.elevatorsOnly} disabled={wc} onChange={e => patch({ requirements: { ...req, elevatorsOnly: e.target.checked } })} />
            <span><b>Use elevators to change floors</b><small>In this map the only other way between floors is stairs, so this follows the same rule as step-free.</small></span></label>
        </section>

        <section className="card" aria-labelledby="pref-h">
          <h2 id="pref-h"><span className="step-num">3</span> Preferences <span className="tag">Optional</span></h2>
          <fieldset className="radio-row"><legend>Recommend the route that is</legend>
            {([["fastest", "Fastest"], ["shortest", "Shortest distance"], ["fewest_turns", "Fewest turns"]] as const).map(([v, l]) =>
              <label key={v} className="pill-radio"><input type="radio" name="priority" checked={t.preferences.priority === v} onChange={() => patch({ preferences: { ...t.preferences, priority: v } })} /> {l}</label>)}
          </fieldset>
          <label className="check-lg"><input type="checkbox" checked={t.preferences.avoidNarrow} onChange={e => patch({ preferences: { ...t.preferences, avoidNarrow: e.target.checked } })} />
            <span><b>Prefer to avoid narrow corridors</b><small>{facts.narrowSegments} corridor segments are flagged as potentially narrow (synthetic flag). Used to pick the recommended route when an alternative exists.</small></span></label>
          <details className="unavailable"><summary>Preferences we can't offer yet (no data)</summary>
            <ul><li>Gentle slopes and ramp gradients: no slope data.</li><li>Smooth surfaces, kerb cuts: outdoor accessibility is unknown beyond steps.</li>
              <li>Rest stops, seating, restrooms en route: not mapped.</li><li>Quiet or less crowded routes, lighting: not mapped.</li></ul></details>
        </section>

        <section className="card" aria-labelledby="avoid-h">
          <h2 id="avoid-h"><span className="step-num">4</span> Obstacles and restrictions</h2>
          <label className="check-lg"><input type="checkbox" checked={t.restrictions.avoidVerifiedObstacles} onChange={e => patch({ restrictions: { ...t.restrictions, avoidVerifiedObstacles: e.target.checked } })} />
            <span><b>Avoid verified obstacles</b><small>Reports a reviewer has verified. Pending and rejected reports never change routes.</small></span></label>
          <label className="field-lg"><span>Demo obstacle scenario (synthetic)</span>
            <select value={t.restrictions.scenario} onChange={e => patch({ restrictions: { ...t.restrictions, scenario: e.target.value } })}>
              <option value="">None</option>
              {data.unified.scenarios.filter(s => s.scenario_id !== "SCN-NORMAL").map(s => <option key={s.scenario_id} value={s.scenario_id}>{s.description ?? s.scenario_id}</option>)}
            </select></label>
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="submit" className="btn btn-primary btn-lg">Show route options</button></div>
      </form>
    </div>
  );
}
