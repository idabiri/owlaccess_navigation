// /navigate, /report and /review: the unified map view (NavigationApp) inside the site shell, opened on the matching panel.
// /navigate starts from the trip planned on /plan and follows the alternative chosen on /suggestions.
import { NavigationApp, type Panel } from "../components/NavigationApp";
import { useAppState } from "../app/AppState";
import { Link } from "../app/router";
import { useIsPhone } from "../app/useMedia";
import type { AppData } from "../data";

/** The preloaded demo obstacles: part of the routing data, so every visitor sees exactly the same ones. Only verified ones can
 *  block a route, and only while their demo scenario is switched on (Plan > Demo options). Pending and resolved ones never do. */
function DemoObstacles({ data }: { data: AppData }) {
  const sc = new Map(data.unified.scenarios.map(s => [s.scenario_id, s.description ?? s.scenario_id]));
  const blocks = (o: AppData["unified"]["obstacles"][number]) => o.status === "verified" && o.verified;
  return (
    <section className="card demo-obstacles" aria-labelledby="demo-obs-h">
      <h2 id="demo-obs-h">Preloaded demo obstacles</h2>
      <p className="muted">Made-up obstacles that ship with the website, <strong>the same for every visitor</strong>. A verified one changes routes only while its demo scenario is on (<Link to="/plan">Plan</Link> &rsaquo; Demo options). Pending and resolved ones never block a route.</p>
      <ul className="report-list" aria-label="Preloaded demo obstacles">
        {data.unified.obstacles.map(o => (
          <li key={o.obstacle_id} className={`report-card ${blocks(o) ? "verified" : o.status === "pending" ? "" : "closed"}`}>
            <div className="rc-head"><span className="rc-what">{(o.description ?? o.obstacle_id).replace(/^SYNTHETIC DEMO DATA - /, "")}</span></div>
            <div className="rc-meta">
              <span className={`badge ${o.status}`}>{o.status === "verified" ? "verified (approved)" : o.status}</span>{" "}
              {blocks(o) ? <>Blocks routes when on: {((o as unknown as { scenario_ids?: string[] }).scenario_ids ?? []).map(id => sc.get(id) ?? id).join("; ")}</> : <>Never blocks a route.</>}
              <span className="rc-ref">{o.obstacle_id}</span>
            </div>
          </li>))}
      </ul>
    </section>
  );
}

function MapPage({ panel, title, intro, allowClear = true }: { panel: Panel; title: string; intro: React.ReactNode; allowClear?: boolean }) {
  const { data, store, trip } = useAppState();
  const phone = useIsPhone();
  const fromTrip = panel === "directions" && !!trip.start && !!trip.goal;
  const following = fromTrip && !!trip.chosen;
  // phones: the map appears only after a route is confirmed on Route options (desktop keeps the map with its built-in planner)
  if (phone && panel === "directions" && !following) return (
    <div className="page"><div className="page-head">
      <h1>{title}</h1>
      <p className="lede-sm">{fromTrip ? "Choose one of the route options first, then press Start navigation. The map opens here with that route." : "Plan a trip and choose a route first. The map opens here once you press Start navigation."}</p>
      <div className="row wrap">
        {fromTrip && <Link to="/suggestions" className="btn btn-primary">See route options</Link>}
        <Link to="/plan" className={fromTrip ? "btn btn-ghost" : "btn btn-primary"}>Plan a route</Link>
      </div>
    </div></div>);
  const initial = {
    start: trip.start, goal: trip.goal,
    mode: (trip.requirements.wheelchair ? "wheelchair" : "walking") as "wheelchair" | "walking",
    avoidStairs: trip.requirements.stepFree || trip.requirements.elevatorsOnly,
    avoidObstacles: trip.restrictions.avoidVerifiedObstacles, scenario: trip.restrictions.scenario,
  };
  const label = (id: string) => data.unified.endpoints_meta.find(m => m.id === id)?.label ?? id;
  return (
    <div className={following ? "map-page following" : "map-page"}>
      {following && trip.chosen
        ? <div className="page-head compact trip-head">
            <div>
              <h1>{title} to {label(trip.goal)}</h1>
              <p className="trip-from">From {label(trip.start)} &middot; <span className="chip">Following: {trip.chosen.name}</span></p>
            </div>
            <div className="back-row"><Link to="/suggestions" className="btn btn-ghost">‹ Route options</Link><Link to="/plan" className="btn btn-ghost">New trip</Link></div>
          </div>
        : <div className="page-head compact">
            <h1>{title}</h1>
            <p className="lede-sm">{intro}</p>
          </div>}
      <NavigationApp data={data} reportStore={store} embedded initialPanel={panel} allowClear={allowClear}
        initial={fromTrip ? initial : undefined} strategy={fromTrip ? trip.chosen?.strategy : undefined} autoCalculate={fromTrip} />
      {panel === "review" && <DemoObstacles data={data} />}
    </div>
  );
}

export const NavigatePage = () => (
  <MapPage panel="directions" title="Navigate"
    intro={<>Follow the highlighted route and the turn-by-turn steps. If a reviewer verifies an obstacle on your route, it is recalculated here. <Link to="/plan">Plan a different trip</Link></>} />
);
export const ReportPage = () => (
  <MapPage panel="report" title="Report an accessibility issue"
    intro={<>Tell us what is in the way. A reviewer checks every report before any route changes.</>} />
);
export const ReviewPage = () => (
  <MapPage panel="review" title="Review reports" allowClear={false}
    intro={<>Work through the reports waiting beside the map. Only reports you <b>verify</b> change routes. The preloaded demo obstacles are listed below the map.</>} />
);
