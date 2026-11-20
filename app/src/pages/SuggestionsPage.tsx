import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../app/AppState";
import { Link, useRouter } from "../app/router";
import { suggestRoutes, type RouteSuggestion } from "../routing/alternatives";
import { blockingObstacles, type ObstacleReport } from "../reports/obstacleReports";
import { OutdoorMap } from "../components/OutdoorMap";
import { IndoorMap } from "../components/IndoorMap";
import { useIsPhone } from "../app/useMedia";

const fmtTime = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const WARN_SHORT: Record<string, string> = {
  SYNTHETIC_INDOOR: "Synthetic indoor plan", PROVISIONAL_ENTRANCE: "Provisional entrance", OUTDOOR_ACCESSIBILITY_UNKNOWN: "Outdoor surfaces unknown",
  POTENTIALLY_NARROW: "Potentially narrow corridor", RAMP_SLOPE_UNKNOWN: "Ramp slope unknown", ELEVATOR_UNVERIFIED: "Elevator availability unverified",
  OBSTACLES_APPLIED: "Avoids verified obstacles", OBSTACLES_IGNORED: "Obstacles NOT considered", NOT_FIELD_VERIFIED: "Not field-verified",
};
const PRIORITY: Record<string, string> = { fastest: "Fastest", shortest: "Shortest distance", fewest_turns: "Fewest turns" };
/** one line of accessibility facts for a route, all read from the computed route itself */
const accessLine = (s: RouteSuggestion) => [s.route.usesStairs ? "Uses stairs" : "No stairs", s.route.usesElevator ? (s.elevators.join(", ") || "Elevator") : null].filter(Boolean).join(" · ");

/** /suggestions: real route alternatives from the routing engine, with the selected one highlighted on the map. */
export function SuggestionsPage() {
  const { data, store, trip, setTrip } = useAppState();
  const { navigate } = useRouter();
  const phone = useIsPhone();   // phones: no map before a route is confirmed; it appears on /navigate after "Start navigation"
  const [reports, setReports] = useState<ObstacleReport[] | null>(store ? null : []);
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
  const start = (s: RouteSuggestion) => { setTrip({ ...trip, chosen: { strategy: s.strategy, name: s.name } }); navigate("/navigate"); };

  return (
    <div className={phone && selected ? "page wide sugg-page has-start-bar" : "page wide sugg-page"}>
      <div className="page-head">
        <p className="eyebrow">Step 2 of 3 &middot; Compare</p>
        <h1>Route options</h1>
        <p className="lede-sm"><b>{label(trip.start)}</b> → <b>{label(trip.goal)}</b> &middot; <Link to="/plan">Change</Link></p>
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
          {result.failure.appliedObstacles.length > 0 && <p className="muted">Verified obstacles in effect: {result.failure.appliedObstacles.join(", ")}.</p>}
          <Link to="/plan" className="btn btn-ghost">Adjust the plan</Link>
        </section>)}
      {suggestions.length > 0 && selected && (
        <div className="sugg-layout">
          <section aria-labelledby="opts-h" className="sugg-list">
            <h2 id="opts-h" className="sr-only">{suggestions.length} route option{suggestions.length > 1 ? "s" : ""}</h2>
            <p className="muted">{suggestions.length === 1 ? "Only one distinct route exists for these settings." : `${suggestions.length} distinct routes, each computed by the routing engine.`}</p>
            <ul className="sugg-cards" aria-label="Route options">
              {suggestions.map(s => {
                const on = s.id === selected.id;
                return (
                  <li key={s.id} className={on ? "sugg-card on" : "sugg-card"} data-testid={`suggestion-${s.id}`}>
                    <div className="sugg-top">
                      <h3>{s.name}</h3>
                      <div className="badges">{s.recommended && <span className="badge-pill rec">Recommended</span>}{s.badges.map(b => <span key={b} className="badge-pill">{b}</span>)}</div>
                    </div>
                    <dl className="sugg-metrics">
                      <div><dt>Distance</dt><dd data-testid="sugg-distance">{s.route.distanceM.toFixed(1)} m</dd></div>
                      <div><dt>Time</dt><dd data-testid="sugg-time">{fmtTime(s.route.travelTimeS)}</dd></div>
                      <div><dt>Floor changes</dt><dd>{s.floorChanges}</dd></div>
                      <div><dt>Turns</dt><dd>{s.turns}</dd></div>
                      <div><dt>Elevator / stairs</dt><dd>{s.route.usesElevator ? s.elevators.join(", ") || "Elevator" : "No elevator"}{s.route.usesStairs ? " · uses stairs" : " · no stairs"}</dd></div>
                    </dl>
                    <ul className="why" aria-label={`Why ${s.name}`}>{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    <ul className="warn-chips" aria-label={`Warnings for ${s.name}`}>{s.route.warnings.map(w => <li key={w.code} title={w.message} className={w.code === "OBSTACLES_IGNORED" ? "warn-chip strong" : "warn-chip"}>{WARN_SHORT[w.code] ?? w.code}</li>)}</ul>
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
                  altRoutes={suggestions.filter(s => s.id !== selected.id).map(s => s.route)} />
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
