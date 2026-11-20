import { useAppState } from "../app/AppState";
import { dataFacts } from "../app/dataFacts";
import { Link } from "../app/router";

/** /about: what is real, synthetic, verified and unknown, and how reports and routing work. Counts come from the loaded data. */
export function AboutPage() {
  const { data } = useAppState();
  const f = dataFacts(data);
  const conn = data.connectors;
  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Data transparency</p>
        <h1>What OwlAccess knows, and what it doesn't</h1>
        <p className="lede-sm">A navigation app is only as trustworthy as its data. Here is exactly where ours comes from and how sure we are about it.</p>
      </div>
      <div className="legend-row" aria-label="Data labels used on this page">
        <span className="dl real">Real source data</span><span className="dl synth">Synthetic</span><span className="dl prov">Provisional / unverified</span><span className="dl unknown">Unknown</span>
      </div>

      <section className="card about" aria-labelledby="a-out"><h2 id="a-out"><span className="dl real">Real</span> Outdoor map: OpenStreetMap, prepared in QGIS</h2>
        <ul>
          <li><b>{f.outdoorKm} km</b> of walkable campus paths in <b>{f.outdoorSegments}</b> segments, from OpenStreetMap footways and crossings, cleaned in QGIS for the Marietta campus.</li>
          <li><b>{f.buildings}</b> building outlines ({f.namedBuildings} named) from OpenStreetMap.</li>
          <li><b>{f.outdoorSteps}</b> path segments are marked as <b>steps</b>; wheelchair and step-free routes never use them.</li>
        </ul></section>

      <section className="card about" aria-labelledby="a-in"><h2 id="a-in"><span className="dl synth">Synthetic</span> Indoor floor plans</h2>
        <ul>
          <li>The Academic Building has <b>{f.indoorFloors}</b> floors with <b>{f.indoorRooms}</b> rooms, hallways, two elevators and two stairwells. Its outline is real (OpenStreetMap); <b>everything inside is a generated demonstration layout</b>, not an official KSU floor plan.</li>
          <li>Door widths, hallway widths and the <b>{f.narrowSegments}</b> "potentially narrow" corridor flags are synthetic too.</li>
          <li>Design 2 and the Engineering Technology Center have <b>no indoor map</b>: they appear as outlines only.</li>
        </ul></section>

      <section className="card about" aria-labelledby="a-ent"><h2 id="a-ent"><span className="dl prov">Provisional</span> Entrances and connections</h2>
        <ul>
          <li>Entrance points come from KSU's published accessibility map, digitised in QGIS. <b>None has been checked in the field.</b></li>
          <li>Indoor entrances: <b>{f.entrances.indoor}</b>. Connected to the outdoor path network: <b>{f.entrances.connected}</b> ({f.entrances.connectedVerified} verified, {f.entrances.connectedProvisional} provisional).</li>
        </ul>
        <table className="data-table"><caption className="sr-only">Indoor entrances and their outdoor connection</caption>
          <thead><tr><th scope="col">Indoor entrance</th><th scope="col">Connection</th><th scope="col">Status</th></tr></thead>
          <tbody>{conn.map(c => <tr key={c.connector_id}><td>{c.indoor_feature_id.replace("_", " ")}</td><td>{c.outdoor_node_id ? `Outdoor point ${c.outdoor_node_id.replace("oe_", "")}` : "Not connected"}</td>
            <td>{c.outdoor_node_id ? <span className="dl prov">{c.verification_status.replace(/_/g, " ")}</span> : <span className="dl unknown">{c.reason ? "not connected" : c.status.replace(/_/g, " ")}</span>}</td></tr>)}</tbody>
        </table></section>

      <section className="card about" aria-labelledby="a-unk"><h2 id="a-unk"><span className="dl unknown">Unknown</span> What we can't tell you yet</h2>
        <ul>
          <li>Outdoor surfaces, slopes, kerb cuts and path widths: the source data only identifies steps.</li>
          <li>Ramp gradients, elevator availability, automatic doors, restroom details and lighting.</li>
          <li>Whether any accessibility flag matches the real building. Every route says so in its warnings.</li>
        </ul></section>

      <section className="card about" aria-labelledby="a-rev"><h2 id="a-rev">How obstacle reports are reviewed</h2>
        <ol>
          <li>Anyone can report an obstacle at a spot on a floor. It is saved as <b>pending</b> and shown on the map, but it <b>changes no route</b>.</li>
          <li>A rule-based helper (keyword matching, not AI) suggests a category and severity. It is labelled as a suggestion and never verifies anything.</li>
          <li>A reviewer verifies or rejects the report and confirms its severity: <i>blocks everyone</i>, <i>blocks wheelchair users</i> (only wheelchair routes avoid it) or <i>minor</i> (no route change).</li>
          <li>Only <b>verified</b> reports affect routing. When one is verified or resolved, open routes recalculate on every device.</li>
        </ol>
        <p className="muted">The demo has no sign-in for reviewers. A real deployment would need staff accounts.</p></section>

      <section className="card about" aria-labelledby="a-route"><h2 id="a-route">How routing handles your requirements</h2>
        <ul>
          <li>Routes are found on one graph joining outdoor paths, the connected entrance and the indoor floors, by quickest travel time (or shortest distance on request).</li>
          <li><b>Wheelchair accessible</b> removes stairs, steps and anything not marked accessible. <b>Step-free</b> removes stairs and steps. These are rules: if no route qualifies you get <code>NO_ACCESSIBLE_ROUTE</code>, never a route that breaks them.</li>
          <li>Route options on <Link to="/suggestions">Compare</Link> are all computed by the same engine (fastest, shortest, other elevator, avoiding narrow corridors); identical paths are shown once.</li>
          <li>Walking speeds are assumptions (outdoors 1.3 m/s), so times are estimates.</li>
        </ul></section>
    </div>
  );
}

export function NotFoundPage() {
  return <div className="page"><div className="page-head"><h1>Page not found</h1><p className="lede-sm">That address isn't part of OwlAccess.</p><Link to="/" className="btn btn-primary">Go to the home page</Link></div></div>;
}
