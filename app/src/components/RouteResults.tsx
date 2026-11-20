import type { RouteResult } from "../routing/unifiedRouting";
import type { NavigationPlan, Instruction } from "../routing/instructions";
import type { NavStep } from "../routing/steps";

const fmtTime = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const ICON: Record<Instruction["kind"], string> = { start: "●", walk: "↑", "turn-walk": "↱", enter: "⇥", exit: "⇤", elevator: "⇅", stairs: "▤", ramp: "◢", arrive: "⚑" };
const KIND_LABEL: Partial<Record<Instruction["kind"], string>> = { elevator: "Elevator · step-free", ramp: "Ramp · step-free", stairs: "Stairs", enter: "Entrance", exit: "Entrance", arrive: "Destination", start: "Start" };
/** turn-arrow direction for a step, from its own text */
const turnIcon = (s: Instruction) => (s.kind !== "turn-walk" ? ICON[s.kind] : /left/i.test(s.text) ? "↰" : "↱");

export interface RouteSummaryProps {
  result: RouteResult | null; plan: NavigationPlan | null; error?: string | null; mode: "walking" | "wheelchair";
  activeSegment: number; onSegment: (i: number) => void; notice?: string | null;
  /** step-by-step navigation (optional, so older callers still work) */
  steps?: NavStep[]; activeStep?: number; onStep?: (i: number) => void;
}
/** Always visible above the map, whichever panel is open: the route's outcome, the current step and the step controls. */
export function RouteSummary({ result, plan, error, mode, activeSegment, onSegment, notice, steps, activeStep = 0, onStep }: RouteSummaryProps) {
  const noticeEl = notice ? <p className="route-notice" data-testid="route-notice">{notice}</p> : null;
  if (error) return <section className="route-strip" role="alert" aria-label="Route"><p className="err">{error}</p></section>;
  if (!result) return <section className="route-strip idle" aria-label="Route">{noticeEl}<p className="muted">Choose a start and destination, then calculate a route.</p></section>;
  if (!result.found) {
    const acc = result.reason === "NO_ACCESSIBLE_ROUTE";
    return (
      <section className="route-strip none" role="alert" aria-live="assertive" aria-label="Route">
        {noticeEl}
        <p className="err" data-reason={result.reason}><strong>{acc ? "No accessible route found." : "No route found."}</strong> <code>{result.reason}</code></p>
        <p className="muted">{acc ? "No path exists that avoids stairs, inaccessible entrances and verified obstacles. Check the elevators and entrances, or try a different destination." : "These two places are not connected in the current data (or a verified obstacle blocks every path)."}</p>
        {result.appliedObstacles.length > 0 && <p className="muted">Verified obstacles in effect: {result.appliedObstacles.join(", ")}.</p>}
      </section>
    );
  }
  const segs = plan!.segments, cur = steps?.[activeStep];
  return (
    <section className="route-strip" aria-label="Route">
      {noticeEl}
      <dl className="summary">
        <div><dt>Total distance</dt><dd data-testid="total-distance">{result.distanceM.toFixed(1)} m</dd></div>
        <div><dt>Estimated time</dt><dd data-testid="total-time">{fmtTime(result.travelTimeS)}</dd></div>
        <div><dt>Mode</dt><dd>{mode === "wheelchair" ? "Wheelchair" : "Walking"}</dd></div>
        <div><dt>Floors</dt><dd>{result.floors.length ? result.floors.map(f => f.split("_F")[1]).join(", ") : "outdoors only"}</dd></div>
      </dl>
      {cur && steps && onStep && (
        <div className="strip-step" aria-live="polite">
          <button type="button" className="icon-btn" onClick={() => onStep(activeStep - 1)} disabled={activeStep <= 0} aria-label="Previous step">‹</button>
          <p><span className="step-icon" aria-hidden="true">{turnIcon(cur.ins)}</span> <b>Step {activeStep + 1} of {steps.length}:</b> {cur.ins.text} <span className="muted">· {cur.place}</span></p>
          <button type="button" className="icon-btn" onClick={() => onStep(activeStep + 1)} disabled={activeStep >= steps.length - 1} aria-label="Next step">›</button>
        </div>)}
      <div className="stepper" role="group" aria-label="Route parts (outdoors and floors)">
        <button type="button" onClick={() => onSegment(activeSegment - 1)} disabled={activeSegment <= 0}>&laquo; Previous</button>
        <span data-testid="segment-label">Part {activeSegment + 1} of {segs.length}: {segs[activeSegment].kind === "outdoor" ? "outdoors" : `indoors, floor ${segs[activeSegment].floor}`}</span>
        <button type="button" onClick={() => onSegment(activeSegment + 1)} disabled={activeSegment >= segs.length - 1}>Next &raquo;</button>
      </div>
    </section>
  );
}

export interface RouteResultsProps {
  result: RouteResult | null; plan: NavigationPlan | null; activeInstruction: number; onInstruction: (i: number) => void;
  steps?: NavStep[]; mode?: "walking" | "wheelchair";
}
/** The directions panel: progress, the current step, Previous/Next, and every step (done / current / upcoming), with warnings beside each. */
export function RouteResults({ result, plan, activeInstruction, onInstruction, steps = [], mode = "walking" }: RouteResultsProps) {
  if (!result || !result.found || !plan) return null;
  const cur = steps[activeInstruction], total = result.distanceM;
  const done = cur ? Math.min(total, cur.distanceBeforeM) : 0, pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="panel results directions"><h2>Directions</h2>
      {cur && <>
        <div className="progress" aria-label="Route progress">
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={activeInstruction + 1} aria-valuetext={`Step ${activeInstruction + 1} of ${steps.length}, ${done.toFixed(0)} of ${total.toFixed(0)} m`}>
            <span style={{ width: `${Math.max(pct, activeInstruction === steps.length - 1 ? 100 : 0)}%` }} /></div>
          <p className="muted">Step {activeInstruction + 1} of {steps.length} &middot; {done.toFixed(0)} of {total.toFixed(0)} m covered</p>
        </div>
        <div className={`current-step kind-${cur.ins.kind}`} aria-live="polite" data-testid="current-step">
          <span className="step-icon big" aria-hidden="true">{turnIcon(cur.ins)}</span>
          <div>
            <p className="cs-meta">{cur.place}{cur.floor !== null ? " · Academic Building (synthetic)" : ""}{KIND_LABEL[cur.ins.kind] ? ` · ${KIND_LABEL[cur.ins.kind]}` : ""}</p>
            <p className="cs-text">{cur.ins.text}</p>
            {cur.ins.distanceM > 0 && <p className="cs-meta">{cur.ins.distanceM.toFixed(0)} m &middot; about {fmtTime(cur.ins.timeS)}{mode === "wheelchair" ? " (estimated from the data's walking speeds; your pace may differ)" : ""}</p>}
            {cur.warnings.length > 0 && <ul className="step-warn" aria-label="Warnings for this step">{cur.warnings.map(w => <li key={w}>⚠ {w}</li>)}</ul>}
          </div>
        </div>
        <div className="row step-nav">
          <button type="button" className="btn-step" onClick={() => onInstruction(activeInstruction - 1)} disabled={activeInstruction <= 0}>‹ Previous step</button>
          <button type="button" className="btn-step primary-step" onClick={() => onInstruction(activeInstruction + 1)} disabled={activeInstruction >= steps.length - 1}>Next step ›</button>
        </div>
        <p className="sim-note">📍 The position marker on the map is <b>simulated</b> from the step you select: a demo feature. OwlAccess does not detect where you are indoors.</p>
      </>}
      {plan.floorTransitions.length > 0 && <ul className="transitions" aria-label="Floor transitions">{plan.floorTransitions.map((t, i) => <li key={i}>{t.via === "elevator" ? "⇅ " : "▤ "}{t.text}</li>)}</ul>}
      <ol className="steps nav-steps" aria-label="Turn-by-turn instructions">
        {plan.instructions.map((s, i) => {
          const st = steps[i], state = i < activeInstruction ? "done" : i === activeInstruction ? "on" : "todo";
          return (
            <li key={i} className={`${state}${i === activeInstruction ? " on" : ""}`} data-state={state}>
              <button type="button" onClick={() => onInstruction(i)} aria-current={i === activeInstruction ? "step" : undefined}>
                <span className="step-icon" aria-hidden="true">{state === "done" ? "✓" : turnIcon(s)}</span>
                <span className="step-body"><span className="step-text">{s.text}</span>
                  <span className="step-meta">{st?.place}{s.distanceM > 0 ? ` · ${s.distanceM.toFixed(0)} m` : ""}{st?.stepFree ? " · step-free" : ""}</span></span>
                <span className="sr-only">{state === "done" ? " (done)" : state === "on" ? " (current step)" : ""}</span>
              </button>
              {st && st.warnings.length > 0 && <span className="warn-tag">⚠ {st.warnings.join(" · ")}</span>}
            </li>);
        })}
      </ol>
      <h3>Accessibility limitations</h3>
      <ul className="warnings">{result.warnings.map(w => <li key={w.code} data-code={w.code}>{w.message}</li>)}</ul>
    </section>
  );
}
