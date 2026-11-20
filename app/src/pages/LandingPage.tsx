import { useState } from "react";
import { Link, useRouter } from "../app/router";
import { useAppState } from "../app/AppState";
import { dataFacts } from "../app/dataFacts";
import { MobilityChoice, PlaceSelect, mobilityOf, requirementsFor } from "../app/TripFields";
import { HeroSketch } from "./HeroSketch";

/** / : most visitors want to get somewhere, so the page starts with the trip itself. Below it: reporting a problem,
 *  and an honest account of what is real. Every number shown is computed from the loaded data. */
export function LandingPage() {
  const { data, trip, setTrip } = useAppState();
  const { navigate } = useRouter();
  const f = dataFacts(data);
  const [start, setStart] = useState(trip.start);
  const [goal, setGoal] = useState(trip.goal);
  const [mob, setMob] = useState(mobilityOf(trip.requirements));
  const [error, setError] = useState<string | null>(null);
  const keep = () => ({ ...trip, start, goal, requirements: requirementsFor(mob), chosen: null });
  const go = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!start || !goal) return setError("Choose where you are starting and where you are going.");
    if (start === goal) return setError("The start and the destination are the same place.");
    setTrip(keep()); navigate("/suggestions");
  };
  const morePlanning = (ev: React.MouseEvent) => { ev.preventDefault(); setTrip(keep()); navigate("/plan"); };

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-copy">
          <h1 id="hero-h">Where are you <span className="accent-text scribble">headed?<svg className="scribble-line" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12 C 40 4, 80 15, 120 8 S 180 6, 197 10" /></svg></span></h1>
          <p className="lede">Step-free routes across KSU Marietta, from the sidewalk to the room, indoors and out.</p>
          <form className="quick-trip" onSubmit={go} aria-label="Find a route" noValidate>
            <PlaceSelect label="From" value={start} onChange={setStart} endpoints={data.unified.endpoints_meta} hint="Choose where you are starting" />
            <PlaceSelect label="To" value={goal} onChange={setGoal} endpoints={data.unified.endpoints_meta} hint="Choose your destination" />
            <MobilityChoice value={mob} onChange={setMob} compact />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="quick-actions">
              <button type="submit" className="btn btn-primary btn-lg">Find routes</button>
              <a href="/plan" className="more-link" onClick={morePlanning}>More trip options</a>
            </div>
          </form>
        </div>
        <div className="hero-card">
          <HeroSketch />
          <div className="sign" aria-hidden="true">
            <div className="hc-row"><span className="hc-dot start" /> Academic Building Entrance <span className="hc-tag">provisional</span></div>
            <div className="hc-row"><span className="hc-dot lift" /> Elevator to Floor 3</div>
            <div className="hc-row"><span className="hc-dot goal" /> Research Lab 302</div>
          </div>
        </div>
      </section>

      <section className="next-row" aria-label="Other things you can do">
        <Link to="/report" className="next-card report">
          <b>Something in the way?</b>
          <span>Report a blocked hallway, a broken elevator or construction. A reviewer checks it before any route changes.</span>
        </Link>
        <Link to="/navigate" className="next-card">
          <b>Explore the map</b>
          <span>Look around the campus paths and the three floors of the Academic Building.</span>
        </Link>
      </section>

      <section className="honest" aria-labelledby="honest-h">
        <h2 id="honest-h">What&rsquo;s real in this prototype</h2>
        <ul className="honest-list">
          <li><span className="dl real">Real</span> <span><b>{f.outdoorKm} km of campus paths</b> and {f.buildings} building outlines from OpenStreetMap. Not field-checked.</span></li>
          <li><span className="dl prov">Provisional</span> <span><b>Building entrances</b> read from KSU&rsquo;s published accessibility map. {f.entrances.connected} connects to an indoor plan so far.</span></li>
          <li><span className="dl synth">Synthetic</span> <span><b>The Academic Building&rsquo;s {f.indoorFloors} floors</b> ({f.indoorRooms} rooms) are an invented demo layout, not the real building.</span></li>
          <li><span className="dl unknown">Unknown</span> <span><b>Surfaces, slopes and curb cuts</b> outdoors. Only steps are known.</span></li>
        </ul>
        <p className="honest-links"><Link to="/about">How the data works</Link> &middot; <Link to="/review">For reviewers: review reports</Link></p>
      </section>
    </div>
  );
}
