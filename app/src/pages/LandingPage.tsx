import { Link } from "../app/router";
import { useAppState } from "../app/AppState";
import { dataFacts } from "../app/dataFacts";
import { HeroSketch, Picto } from "./HeroSketch";

/** / : what OwlAccess is, how it works, and how honest its data is. Every number shown is computed from the loaded data. */
export function LandingPage() {
  const { data } = useAppState();
  const f = dataFacts(data);
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-copy">
          <p className="eyebrow">KSU Marietta campus &middot; student prototype</p>
          <h1 id="hero-h">Get across campus <span className="accent-text scribble">your way<svg className="scribble-line" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12 C 40 4, 80 15, 120 8 S 180 6, 197 10" /></svg></span>, step-free when you need it.</h1>
          <p className="lede">OwlAccess plans routes from the sidewalk to the room, indoors and out, honours your accessibility needs, and lets people report obstacles that a reviewer checks before routes change.</p>
          <div className="hero-actions">
            <Link to="/plan" className="btn btn-primary btn-lg">Plan a route</Link>
            <Link to="/report" className="btn btn-ghost btn-lg">Report an obstacle</Link>
          </div>
          <p className="hero-note">Indoor floor plans are <strong>synthetic</strong>, and accessibility details are <strong>not field-verified</strong>. <Link to="/about">See what is real</Link>.</p>
        </div>
        <div className="hero-card">
          <HeroSketch />
          <div className="sign" aria-hidden="true">
            <div className="hc-row"><span className="hc-dot start" /> Outdoor ENT007 <span className="hc-tag">provisional</span></div>
            <div className="hc-row"><span className="hc-dot lift" /> Elevator to Floor 3</div>
            <div className="hc-row"><span className="hc-dot goal" /> Research Lab 302</div>
            <div className="hc-meta"><span>Wheelchair</span><span>No stairs</span><span>Real engine</span></div>
          </div>
        </div>
      </section>

      <section className="stats" aria-label="The data behind OwlAccess">
        <div className="stat"><b>{f.outdoorKm} km</b><span>of campus paths ({f.outdoorSegments} segments) from OpenStreetMap</span></div>
        <div className="stat"><b>{f.indoorFloors} floors</b><span>{f.indoorRooms} rooms in the Academic Building (synthetic)</span></div>
        <div className="stat"><b>{f.entrances.connected}</b><span>entrance linking outdoors to indoors ({f.entrances.connectedProvisional} provisional, {f.entrances.connectedVerified} verified)</span></div>
        <div className="stat"><b>0</b><span>reports change a route until a person verifies them</span></div>
      </section>

      <section className="features" aria-labelledby="feat-h">
        <h2 id="feat-h">Built around access, not just distance</h2>
        <div className="feature-grid">
          <article className="feature"><span className="f-icon"><Picto kind="access" /></span><h3>Accessible routing</h3>
            <p>Wheelchair and step-free requirements are rules, not suggestions: routes with stairs or links not marked accessible are never offered. When no route qualifies, you are told plainly.</p></article>
          <article className="feature"><span className="f-icon"><Picto kind="layers" /></span><h3>Indoors and outdoors</h3>
            <p>One route from a campus sidewalk through an entrance, along hallways and up elevators to the room, with turn-by-turn directions and floor changes.</p></article>
          <article className="feature"><span className="f-icon"><Picto kind="fork" /></span><h3>Real alternatives</h3>
            <p>Compare the fastest, the shortest, the other elevator and routes that avoid narrow corridors, each computed by the same routing engine.</p></article>
          <article className="feature"><span className="f-icon"><Picto kind="cone" /></span><h3>Obstacle reporting</h3>
            <p>Report a blocked hallway or a broken elevator from any device. A rule-based helper suggests a category; a human reviewer verifies it before routes avoid it.</p></article>
        </div>
      </section>

      <section className="how" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="how-steps">
          <li><b>Plan</b><span>Choose where you are going and what you need: wheelchair, step-free, elevators.</span></li>
          <li><b>Compare</b><span>See real route options with distance, time, floor changes and warnings.</span></li>
          <li><b>Navigate</b><span>Follow the highlighted route and turn-by-turn steps across floors.</span></li>
          <li><b>Report</b><span>Spot a problem? Report it. Verified obstacles reroute everyone they affect.</span></li>
        </ol>
      </section>

      <section className="quick" aria-labelledby="quick-h">
        <h2 id="quick-h">Quick links</h2>
        <div className="quick-grid">
          <Link to="/report" className="quick-card"><b>Report an accessibility issue</b><span>Blocked hallway, broken elevator, construction</span></Link>
          <Link to="/review" className="quick-card"><b>Review reports</b><span>For reviewers: verify or reject what was reported</span></Link>
          <Link to="/about" className="quick-card"><b>Data transparency</b><span>What is real, synthetic, verified and unknown</span></Link>
        </div>
      </section>
    </div>
  );
}
