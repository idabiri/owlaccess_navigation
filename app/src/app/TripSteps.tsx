import { Link } from "./router";

const STEPS = [
  { to: "/plan", label: "Plan" },
  { to: "/suggestions", label: "Choose a route" },
  { to: "/navigate", label: "Go" },
] as const;

/** Where you are in a trip: Plan, then Choose a route, then Go. Earlier steps are links back. */
export function TripSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <nav className="trip-steps" aria-label="Trip progress">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.to} className={i < current ? "done" : i === current ? "now" : "next"}>
            {i < current
              ? <Link to={s.to}><span className="ts-dot" aria-hidden="true">✓</span>{s.label}</Link>
              : <span aria-current={i === current ? "step" : undefined}><span className="ts-dot" aria-hidden="true">{i + 1}</span>{s.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
