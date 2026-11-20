import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../app/AppState";
import { Link, useRouter } from "../app/router";
import { suggestRoutes, type RouteSuggestion } from "../routing/alternatives";
import { blockingObstacles, loadReports, REPORT_CATEGORIES, type ObstacleReport } from "../reports/obstacleReports";
import { TripSteps } from "../app/TripSteps";
import { OutdoorMap } from "../components/OutdoorMap";
import { IndoorMap } from "../components/IndoorMap";
import { useIsPhone } from "../app/useMedia";

const fmtTime = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const WARN_SHORT: Record<string, string> = {
  SYNTHETIC_INDOOR: "Indoor plan is synthetic", PROVISIONAL_ENTRANCE: "Entrance location not field-checked", OUTDOOR_ACCESSIBILITY_UNKNOWN: "Outdoor surfaces and slopes unknown",
  POTENTIALLY_NARROW: "Passes a possibly narrow corridor", RAMP_SLOPE_UNKNOWN: "Ramp slope unknown", ELEVATOR_UNVERIFIED: "Elevators not confirmed working",
  OBSTACLES_APPLIED: "Avoids verified obstacles", OBSTACLES_IGNORED: "Obstacles NOT considered", NOT_FIELD_VERIFIED: "Accessibility not field-checked",
};
const signed = (v: number, unit: string, digits = 0) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} ${unit}`;
/** how an alternative differs from the recommended route, in the words a person would use */
function deltaLine(s: RouteSuggestion, rec: RouteSuggestion) {
  const dt = Math.round(s.route.travelTimeS - rec.route.travelTimeS), dd = Math.round(s.route.distanceM - rec.route.distanceM);
  const size = dt === 0 && dd === 0 ? "Same time and distance" : [dt !== 0 && signed(dt, "s"), dd !== 0 && signed(dd, "m")].filter(Boolean).join(", ");
  const via = s.elevators.join(", ") !== rec.elevators.join(", ") && s.elevators.length ? `uses ${s.elevators.join(" and ")} instead` : "";
  return [size, via].filter(Boolean).join(" · ");
}
const PRIORITY: Record<string, string> = { fastest: "Fastest", shortest: "Shortest distance", fewest_turns: "Fewest turns" };
/** one line of accessibility facts for a route, all read from the computed route itself */
const accessLine = (s: RouteSuggestion) => [s.route.usesStairs ? "Uses stairs" : "No stairs", s.route.usesElevator ? (s.elevators.join(", ") || "Elevator") : null].filter(Boolean).join(" · ");

/** /suggestions: real route alternatives from the routing engine, with the selected one highlighted on the map. */
export function SuggestionsPage() {
  const { data, store, trip, setTrip } = useAppState();
  const { navigate } = useRouter();
  const phone = useIsPhone();   // phones: no map before a route is confirmed; it appears on /navigate after "Start navigation"
  // shared store (local dev): loaded from the server. Public site: the reports saved in this browser, so this visitor's verified reports count here too
  const [reports, setReports] = useState<ObstacleReport[] | null>(store ? null : () => loadReports());
  useEffect(() => { if (store) store.load().then(s => setReports(s.reports)).catch(() => setReports([])); }, [store]);
  const label = (id: string) => data.unified.endpoints_meta.find(m => m.id === id)?.label ?? id;
  const wheelchair = trip.requirements.wheelchair, avoidStairs = trip.requirements.stepFree || trip.requirements.elevatorsOnly;

  const result = useMemo(() => {
    if (!trip.start || !trip.goal || reports === null) return null;
    try {
      return suggestRoutes(data.unified, trip.start, trip.goal,
        { wheelchair, avoidStairs, applyObstacles: trip.restrictions.avoidVerifiedObstacles, scenario: trip.restrictions.scenario || undefined, extraObstacles: blockingObstacles(reports, wheelchair) },
        trip.preferences.priority, { start: label(trip.start), goal: label(trip.goal) }, { preferAvoidNarrow: trip.preferences.avoidNarrow });
    } catch (e) { return { suggestions: [] as RouteSuggestion[], failure: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [trip, reports, data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const suggestions = result?.suggestions ?? [];
  // coming back from /navigate, the route being followed stays selected
  const selected = suggestions.find(s => s.id === selectedId) ?? suggestions.find(s => trip.chosen && s.name === trip.chosen.name) ?? suggestions[0];
  const [view, setView] = useState<string | null>(null);
  const views = selected ? [...(selected.route.domains.includes("outdoor") ? ["outdoor"] : []), ...selected.route.floors] : [];
  const current = view && views.includes(view) ? view : views[0];
  const nodes = useMemo(() => new Map(data.unified.nodes.map(n => [n.node_id, n])), [data]);

  if (!trip.start || !trip.goal) return (
    <div className="page"><div className="page-head"><h1>Route options</h1><p className="lede-sm">Plan a trip first, then compare the options here.</p>
      <Link to="/plan" className="btn btn-primary">Plan a route</Link></div></div>);

  const req = [wheelchair && "Wheelchair accessible", !wheelchair && avoidStairs && "Step-free"].filter(Boolean).join(", ") || "None";
  const prefs = [PRIORITY[trip.preferences.priority] ?? trip.preferences.priority, trip.preferences.avoidNarrow && "avoid narrow corridors",
    trip.restrictions.avoidVerifiedObstacles ? "avoid verified obstacles" : "verified obstacles NOT considered", trip.restrictions.scenario && `scenario ${trip.restrictions.scenario}`].filter(Boolean).join(", ");
  // never show raw ids: name verified reports and demo obstacles the way a person would
  const floorName = (fid: string) => fid.replace(/^BLD001_F/, "Floor ");
  const obstacleName = (id: string) => {
    const r = (reports ?? []).find(x => x.report_id === id);
    if (r) return `${REPORT_CATEGORIES[r.category].toLowerCase()} on ${floorName(r.floor_id)} (reported: “${r.description.trim().slice(0, 40)}”)`;
    const o = data.unified.obstacles.find(x => x.obstacle_id === id);
    return o ? `${(o as { description?: string }).description ?? "a demo obstacle"} (demo)` : "a verified obstacle";
  };
  const reasonsFor = (s: RouteSuggestion) => s.reasons.map(t => (/^Avoids verified obstacle/.test(t) && s.route.appliedObstacles.length
    ? `Avoids ${s.route.appliedObstacles.map(obstacleName).join("; ")}, verified by a reviewer.` : t));
  // caveats every option shares are said once, above the list; each card keeps only what is particular to it
  // (avoiding a verified obstacle is good news, not a caveat: the reasons say it, by name)
  const common = suggestions.length ? suggestions[0].route.warnings.map(w => w.code).filter(c => c !== "OBSTACLES_APPLIED" && suggestions.every(s => s.route.warnings.some(w => w.code === c))) : [];
  const rec = suggestions.find(s => s.recommended) ?? suggestions[0];
  const start = (s: RouteSuggestion) => { setTrip({ ...trip, chosen: { strategy: s.strategy, name: s.name } }); navigate("/navigate"); };

  return (
    <div className={phone && selected ? "page wide sugg-page has-start-bar" : "page wide sugg-page"}>
      <TripSteps current={1} />
      <div className="page-head">
        <h1>Route options</h1>
        <p className="trip-line"><b>{label(trip.start)}</b> <span className="arrow" aria-hidden="true">→</span><span className="sr-only"> to </span> <b>{label(trip.goal)}</b> <Link to="/plan" className="change">Change</Link></p>
        <dl className="trip-facts" aria-label="Your trip settings">
          <div><dt>Requirements</dt><dd data-testid="trip-requirements">{req}</dd></div>
          <div><dt>Preferences</dt><dd data-testid="trip-preferences">{prefs}</dd></div>
        </dl>
      </div>
      {reports === null && <p className="muted" role="status">Loading the latest verified obstacles&hellip;</p>}
      {result && "error" in result && <p className="form-error" role="alert">{(result as { error: string }).error}</p>}
      {result?.failure && (
        <section className="card none-card" role="alert" aria-labelledby="none-h">
          <h2 id="none-h">{result.failure.reason === "NO_ACCESSIBLE_ROUTE" ? "No accessible route meets your requirements" : "No route found"} <code>{result.failure.reason}</code></h2>
          <p>{result.failure.reason === "NO_ACCESSIBLE_ROUTE" ? "Every path between these places needs stairs, an inaccessible link, or passes a verified obstacle. We never offer a route that breaks your requirements." : "These places are not connected in the current data, or a verified obstacle blocks every path."}</p>
          {result.failure.appliedObstacles.length > 0 && <p className="muted">Verified obstacles in effect: {result.failure.appliedObstacles.map(obstacleName).join("; ")}.</p>}
          <Link to="/plan" className="btn btn-ghost">Adjust the plan</Link>
        </section>)}
      {suggestions.length > 0 && selected && (
        <div className="sugg-layout">
          <section aria-labelledby="opts-h" className="sugg-list">
            <h2 id="opts-h" className="sr-only">{suggestions.length} route option{suggestions.length > 1 ? "s" : ""}</h2>
            <p className="sugg-count">{suggestions.length === 1 ? "One route meets your needs." : `${suggestions.length} routes meet your needs. The recommended one is first.`}</p>
            {common.length > 0 && <p className="caveats" role="note"><b>On every route:</b> {common.map(c => WARN_SHORT[c] ?? c).join(" · ")}. <Link to="/about">What&rsquo;s real?</Link></p>}
            <ul className="sugg-cards" aria-label="Route options">
              {suggestions.map(s => {
                const on = s.id === selected.id, lead = s === rec, own = s.route.warnings.filter(w => !common.includes(w.code) && w.code !== "OBSTACLES_APPLIED");
                return (
                  <li key={s.id} className={["sugg-card", on && "on", lead ? "lead" : "alt"].filter(Boolean).join(" ")} data-testid={`suggestion-${s.id}`}>
                    <div className="sugg-top">
                      <h3>{s.name}</h3>
                      <div className="badges">{s.recommended && <span className="badge-pill rec">Recommended</span>}{s.badges.map(b => <span key={b} className="badge-pill">{b}</span>)}</div>
                    </div>
                    {!lead && rec && <p className="delta">{deltaLine(s, rec)}</p>}
                    <dl className="sugg-metrics">
                      <div><dt>Distance</dt><dd data-testid="sugg-distance">{s.route.distanceM.toFixed(1)} m</dd></div>
                      <div><dt>Time</dt><dd data-testid="sugg-time">{fmtTime(s.route.travelTimeS)}</dd></div>
                      <div><dt>Floor changes</dt><dd>{s.floorChanges}</dd></div>
                      <div><dt>Turns</dt><dd>{s.turns}</dd></div>
                      <div><dt>Elevator / stairs</dt><dd>{s.route.usesElevator ? s.elevators.join(", ") || "Elevator" : "No elevator"}{s.route.usesStairs ? " · uses stairs" : " · no stairs"}</dd></div>
                    </dl>
                    {lead
                      ? <ul className="why" aria-label={`Why ${s.name}`}>{reasonsFor(s).map((r, i) => <li key={i}>{r}</li>)}</ul>
                      : <details className="why-more"><summary>Why this route</summary><ul className="why" aria-label={`Why ${s.name}`}>{reasonsFor(s).map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
                    {own.length > 0 && <ul className="warn-chips" aria-label={`Warnings for ${s.name}`}>{own.map(w => <li key={w.code} title={w.message} className={w.code === "OBSTACLES_IGNORED" ? "warn-chip strong" : "warn-chip"}>{WARN_SHORT[w.code] ?? w.code}</li>)}</ul>}
                    <div className="sugg-actions">
                      <button type="button" className="btn btn-ghost" aria-pressed={on} onClick={() => { setSelectedId(s.id); setView(null); }}>{phone ? (on ? "Selected" : "Select") : on ? "Shown on map" : "Show on map"}</button>
                      <button type="button" className="btn btn-primary" onClick={() => start(s)}>Start navigation<span className="sr-only"> with {s.name}</span></button>
                    </div>
                  </li>);
              })}
            </ul>
          </section>
          {!phone && <section className="sugg-map card" aria-label="Map of the route options">
            <div className="map-switch" role="tablist" aria-label="Route map view">
              {views.map(v => <button key={v} type="button" role="tab" aria-selected={v === current} className={v === current ? "tab on" : "tab"} onClick={() => setView(v)}>
                {v === "outdoor" ? "Outdoors" : `Floor ${v.split("_F")[1]}`}</button>)}
            </div>
            <p className="legend"><span className="lg sel" /> {selected.name} <span className="lg alt" /> other options</p>
            {current === "outdoor"
              ? <OutdoorMap data={data} route={selected.route} startNode={data.unified.endpoints[trip.start] ?? trip.start} goalNode={data.unified.endpoints[trip.goal] ?? trip.goal}
                  altRoutes={suggestions.filter(s => s.id !== selected.id).map(s => s.route)} focusNodeIds={selected.route.nodes} />
              : current ? <IndoorMap floor={Number(current.split("_F")[1])} svgText={data.svgs[Number(current.split("_F")[1])]} nodes={nodes}
                  routeNodeIds={selected.route.nodes} altRouteNodeIds={suggestions.filter(s => s.id !== selected.id).map(s => s.route.nodes)}
                  startRoomId={/^room_/.test(trip.start) ? trip.start : null} goalRoomId={/^room_/.test(trip.goal) ? trip.goal : null} /> : null}
          </section>}
        </div>)}
      {phone && selected && (
        <div className="start-bar" role="region" aria-label="Selected route">
          <div className="start-bar-info">
            <b>{selected.name}</b>
            <span><span data-testid="start-bar-distance">{selected.route.distanceM.toFixed(0)} m</span> &middot; {fmtTime(selected.route.travelTimeS)} &middot; {accessLine(selected)}</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => start(selected)}>Start navigation<span className="sr-only"> with {selected.name}</span></button>
        </div>)}
    </div>
  );
}
