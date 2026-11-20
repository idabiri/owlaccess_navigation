// /navigate, /report and /review: the unified map view (NavigationApp) inside the site shell, opened on the matching panel.
// /navigate starts from the trip planned on /plan and follows the alternative chosen on /suggestions.
import { NavigationApp, type Panel } from "../components/NavigationApp";
import { useAppState } from "../app/AppState";
import { Link } from "../app/router";
import { useIsPhone } from "../app/useMedia";

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
  return (
    <div className={following ? "map-page following" : "map-page"}>
      <div className="page-head compact">
        <h1>{title}</h1>
        <p className="lede-sm">{intro}</p>
        {following && trip.chosen && (phone
          ? <div className="back-row"><span className="chip">Following: {trip.chosen.name}</span>
              <div className="row"><Link to="/suggestions" className="btn btn-ghost">‹ Route options</Link><Link to="/plan" className="btn btn-ghost">New trip</Link></div></div>
          : <p className="chip-line"><span className="chip">Following: {trip.chosen.name}</span> <Link to="/suggestions">Change route</Link></p>)}
      </div>
      <NavigationApp data={data} reportStore={store} embedded initialPanel={panel} allowClear={allowClear}
        initial={fromTrip ? initial : undefined} strategy={fromTrip ? trip.chosen?.strategy : undefined} autoCalculate={fromTrip} />
    </div>
  );
}

export const NavigatePage = () => (
  <MapPage panel="directions" title="Navigate"
    intro={<>Follow the highlighted route and the turn-by-turn steps. If a reviewer verifies an obstacle on your route, it is recalculated here. <Link to="/plan">Plan a different trip</Link></>} />
);
export const ReportPage = () => (
  <MapPage panel="report" title="Report an accessibility issue"
    intro={<>Open a floor, press <b>Report an obstacle</b>, then tap the spot (or choose it from the list) and describe it. Reports stay <b>pending</b> and change no route until a reviewer verifies them.</>} />
);
export const ReviewPage = () => (
  <MapPage panel="review" title="Review reports" allowClear={false}
    intro={<>Pending reports are listed beside the map; <b>Show on map</b> jumps to each one. Only reports you <b>verify</b> affect routing, on every device.</>} />
);
