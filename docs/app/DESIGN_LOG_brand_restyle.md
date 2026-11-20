
## 2026-11-19 · Brand restyle "campus field map" (studio feedback: "more human, less AI, super cool")
- New `app/src/brand.css` (loaded last), `app/src/pages/HeroSketch.tsx` (hand-drawn hero sketch + line pictograms), landing page uses them; `main.tsx` imports bundled fonts.
- Fonts: Fraunces (headlines) and Atkinson Hyperlegible (text), installed as npm packages and bundled, so no font service is contacted.
- Paper/ink palette, print-style shadows, route-drawing hero animation (off with prefers-reduced-motion). design.json values unchanged.
- Contrast: text on orange switched from white (2.9:1) to ink (about 6:1).
- Backup: Hacakthon_backups/Hacakthon_backup_2026-11-19_before-brand-restyle.zip

## 2026-11-19 · Stage-focused redesign (studio feedback: "seems AI generated; think about each stage and the flow")
- Place names: survey codes replaced by plain names in the app's display layer (data files unchanged): Academic Building Entrance (ENT007), Engineering Technology Center Entrance (ENT008), Academic Building Ramp (RMP004), and named inside entrances. Step text names the door.
- Landing: starts with "Where are you headed?" (From, To, how you get around, Find routes); marketing sections (stats, feature grid, how-it-works, quick links) replaced by "Something in the way?", "Explore the map" and an honest "What's real" list.
- Plan: one "How do you get around?" choice (Walking / Step-free / Wheelchair) instead of three overlapping checkboxes; demo controls folded into "Demo options"; trip progress (Plan, Choose a route, Go).
- Route options: the recommendation leads; alternatives say how they differ; shared caveats shown once; verified reports named in words, never by id; the map opens on the route.
- Navigate: header names the destination with Route options / New trip; the planner and building picker step aside while following; compact honesty banner.
- Map: symbols and labels keep a constant on-screen size at any zoom (fixes giant overlapping labels); entrances labelled by name.
- Report/Review tabs: route planning steps aside. Robustness: incomplete saved strategies no longer crash routing. Calmer loading screen.
- Tests: 147 pass (5 updated for the new landing and requirement choice, 1 added). Backup: Hacakthon_backup_2026-11-19_before-stage-redesign.zip

## 2026-11-19 · Report and Review screens (studio follow-up: "Yes, do Report/Review")
- Report: guided steps (Where, What's wrong, Send); "Which floor is it on?" with large floor buttons; a "Where" card with Change; description first, then problem and severity side by side; one promise line (pending until verified). Route planning and the building picker stay out of the way.
- Review: summary (waiting / changing routes / closed); readable report cards (problem, severity, place, the reporter's words, how long ago; ref id small); one primary Review action per card; verified cards say who is rerouted, with an "Obstacle cleared" action. All control names used by assistive tech and tests unchanged.
- Tests: 147 pass (1 assertion moved: the rule-based suggestion note now shows in the reviewer queue, where it informs the decision).
