import { useState } from "react";
import { useAppState, type TripPlan } from "../app/AppState";
import { useRouter } from "../app/router";
import { dataFacts } from "../app/dataFacts";
import { TripSteps } from "../app/TripSteps";
import { MobilityChoice, PlaceSelect, mobilityOf, requirementsFor } from "../app/TripFields";

/** /plan: where to, how you get around (requirements: rules every route follows), what you would like (optional
 *  preferences), and, folded away, the demo controls. */
export function PlanPage() {
  const { data, trip, setTrip } = useAppState();
  const { navigate } = useRouter();
  const [t, setT] = useState<TripPlan>(trip);
  const [error, setError] = useState<string | null>(null);
  const facts = dataFacts(data);
  const ep = data.unified.endpoints_meta;
  const patch = (p: Partial<TripPlan>) => setT(s => ({ ...s, ...p }));
  const demoOn = !!t.restrictions.scenario || !t.restrictions.avoidVerifiedObstacles;
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!t.start || !t.goal) return setError("Choose both a starting location and a destination.");
    if (t.start === t.goal) return setError("The starting location and the destination are the same.");
    setError(null); setTrip({ ...t, chosen: null }); navigate("/suggestions");
  };

  return (
    <div className="page">
      <TripSteps current={0} />
      <div className="page-head">
        <h1>Plan an accessible route</h1>
        <p className="lede-sm">Tell us where you are going and how you get around. Every route we suggest follows your requirements.</p>
      </div>
      <form className="plan-form" onSubmit={submit} aria-label="Plan a route" noValidate>
        <section className="card where" aria-labelledby="where-h">
          <h2 id="where-h">Where</h2>
          <div className="where-grid">
            <PlaceSelect label="Starting location" value={t.start} onChange={id => patch({ start: id })} endpoints={ep} />
            <button type="button" className="swap" onClick={() => patch({ start: t.goal, goal: t.start })} aria-label="Swap start and destination" title="Swap start and destination">⇅</button>
            <PlaceSelect label="Destination" value={t.goal} onChange={id => patch({ goal: id })} endpoints={ep} />
          </div>
          <p className="hint">Indoor routes are available for the Academic Building (synthetic floor plan). Other buildings are outdoor-only for now.</p>
        </section>

        <section className="card req" aria-labelledby="req-h">
          <h2 id="req-h">Accessibility requirements <span className="tag tag-must">Must have</span></h2>
          <MobilityChoice value={mobilityOf(t.requirements)} onChange={m => patch({ requirements: requirementsFor(m) })} />
        </section>

        <section className="card" aria-labelledby="pref-h">
          <h2 id="pref-h">Preferences <span className="tag">Optional</span></h2>
          <fieldset className="radio-row"><legend>Recommend the route that is</legend>
            {([["fastest", "Fastest"], ["shortest", "Shortest distance"], ["fewest_turns", "Fewest turns"]] as const).map(([v, l]) =>
              <label key={v} className="pill-radio"><input type="radio" name="priority" checked={t.preferences.priority === v} onChange={() => patch({ preferences: { ...t.preferences, priority: v } })} /> {l}</label>)}
          </fieldset>
          <label className="check-lg"><input type="checkbox" checked={t.preferences.avoidNarrow} onChange={e => patch({ preferences: { ...t.preferences, avoidNarrow: e.target.checked } })} />
            <span><b>Prefer to avoid narrow corridors</b><small>{facts.narrowSegments} corridor segments are flagged as possibly narrow (synthetic flag).</small></span></label>
          <details className="unavailable"><summary>Preferences we can&rsquo;t offer yet</summary>
            <ul><li>Gentle slopes and ramp gradients: no slope data.</li><li>Smooth surfaces, kerb cuts: outdoor accessibility is unknown beyond steps.</li>
              <li>Rest stops, seating, restrooms en route: not mapped.</li><li>Quiet or less crowded routes, lighting: not mapped.</li></ul></details>
        </section>

        <details className="card demo-opts" open={demoOn}>
          <summary><b>Demo options</b> <span className="muted">obstacle scenarios for presentations{demoOn ? " (in use)" : ""}</span></summary>
          <label className="check-lg"><input type="checkbox" checked={t.restrictions.avoidVerifiedObstacles} onChange={e => patch({ restrictions: { ...t.restrictions, avoidVerifiedObstacles: e.target.checked } })} />
            <span><b>Avoid verified obstacles</b><small>Leave this on. Only reports a reviewer has verified change routes; pending and rejected reports never do.</small></span></label>
          <label className="field-lg"><span>Demo obstacle scenario (synthetic)</span>
            <select value={t.restrictions.scenario} onChange={e => patch({ restrictions: { ...t.restrictions, scenario: e.target.value } })}>
              <option value="">None</option>
              {data.unified.scenarios.filter(s => s.scenario_id !== "SCN-NORMAL").map(s => <option key={s.scenario_id} value={s.scenario_id}>{s.description ?? s.scenario_id}</option>)}
            </select></label>
        </details>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="submit" className="btn btn-primary btn-lg">Show route options</button></div>
      </form>
    </div>
  );
}
