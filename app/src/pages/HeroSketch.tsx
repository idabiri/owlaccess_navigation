// The landing page illustration: a hand-drawn campus sketch where the route draws itself from an outdoor entrance,
// through the Academic Building and up the elevator to a lab. It is a drawing, not the map: positions are not to scale.
// Motion is CSS only and switches off for people who ask their device for reduced motion (see brand.css).

export const HERO_ROUTE = "M44 352 C 104 348, 150 334, 190 304 S 268 252, 328 224 L 362 178 L 446 104";

export function HeroSketch() {
  return (
    <svg className="hero-sketch" viewBox="0 0 520 400" role="img" aria-labelledby="hs-t">
      <title id="hs-t">Sketch, not to scale: a route from an outdoor entrance through the Academic Building and up an elevator to Research Lab 302</title>
      <defs>
        <pattern id="hs-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <line x1="0" y1="0" x2="0" y2="7" className="hs-hatch-line" />
        </pattern>
      </defs>
      {/* contour lines: the "paper map" texture */}
      <g className="hs-contours" aria-hidden="true">
        <path d="M-10 60 C 80 30, 160 90, 250 58 S 420 20, 540 52" />
        <path d="M-10 100 C 70 76, 170 130, 260 98 S 430 64, 540 94" />
        <path d="M-10 392 C 90 360, 180 400, 290 372 S 460 340, 540 362" />
        <path d="M-10 250 C 40 236, 90 262, 130 246 S 190 214, 230 230" />
      </g>
      {/* walkways */}
      <g className="hs-paths" aria-hidden="true">
        <path d="M0 356 C 120 350, 160 330, 200 300 S 300 236, 520 236" />
        <path d="M120 400 C 130 330, 110 260, 150 200 S 210 120, 200 0" />
        <path d="M200 300 C 230 340, 300 360, 520 330" />
      </g>
      {/* buildings: rough, slightly crooked blocks */}
      <g aria-hidden="true">
        <path className="hs-bld" d="M64 70 L172 64 L176 146 L66 150 Z" />
        <path className="hs-bld" d="M214 128 L262 126 L264 186 L216 188 Z" />
        <path className="hs-bld main" d="M300 60 L478 54 L484 222 L304 228 Z" />
        <path className="hs-bld-edge" d="M300 60 L478 54 L484 222 L304 228 Z" />
        <text x="312" y="80" className="hs-label small">Academic Building</text>
        <text x="312" y="96" className="hs-label tiny">synthetic interior</text>
      </g>
      {/* the route */}
      <path className="hs-route-shadow" d={HERO_ROUTE} />
      <path className="hs-route" d={HERO_ROUTE} pathLength={1} />
      {/* stops */}
      <g className="hs-stop start" transform="translate(44 352)"><circle r="11" /><circle r="4.5" className="hs-core" /></g>
      <g className="hs-stop lift" transform="translate(362 178)">
        <rect x="-13" y="-13" width="26" height="26" rx="5" />
        <path d="M-4 -2 L0 -7 L4 -2 M-4 2 L0 7 L4 2" className="hs-glyph" />
      </g>
      <g className="hs-stop goal" transform="translate(446 104)">
        <circle r="16" className="hs-pulse" />
        <path d="M-2 10 L-2 -14 L12 -9 L-2 -4" className="hs-flag" />
      </g>
      <circle className="hs-traveler" r="7" />
      {/* hand-written notes */}
      <g aria-hidden="true">
        <text x="30" y="386" className="hs-note">you start here</text>
        <text x="338" y="214" className="hs-note" textAnchor="end">elevator, not stairs</text>
        <text x="470" y="140" className="hs-note" textAnchor="end">Lab 302!</text>
        <path d="M70 380 q 8 -8 4 -16" className="hs-arrow" />
      </g>
    </svg>
  );
}

/** Line pictograms for the feature list, drawn for OwlAccess (no emoji). */
export function Picto({ kind }: { kind: "access" | "layers" | "fork" | "cone" }) {
  return (
    <svg className="picto" viewBox="0 0 40 40" aria-hidden="true">
      {kind === "access" && <>
        <circle cx="21" cy="7" r="3.2" className="pf" />
        <path d="M19 12 L18 22 L27 22 L31 31" />
        <path d="M14 18 a 9 9 0 1 0 12 11" />
        <path d="M18 16 L26 15" />
      </>}
      {kind === "layers" && <>
        <path d="M20 6 L35 13 L20 20 L5 13 Z" />
        <path d="M5 20 L20 27 L35 20" />
        <path d="M5 27 L20 34 L35 27" />
      </>}
      {kind === "fork" && <>
        <path d="M20 35 L20 22 C 20 16, 12 14, 10 6" />
        <path d="M20 22 C 20 16, 28 14, 30 6" className="alt" />
        <path d="M6 9 L10 5 L13 10" /><path d="M27 10 L30 5 L34 9" className="alt" />
      </>}
      {kind === "cone" && <>
        <path d="M14 32 L18 8 L22 8 L26 32" />
        <path d="M16 22 L24 22" /><path d="M15 27 L25 27" className="alt" />
        <path d="M8 33 L32 33" />
      </>}
    </svg>
  );
}
