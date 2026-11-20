
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

## 2026-11-20 · SOS emergency button (studio feedback)
- A red SOS button in the sticky site header on every page, so it never covers the map, the step panel or the Start bar.
- It opens an Emergency help screen: "In an immediate emergency, call 911.", Call 911 (tel:911) listed first, Call KSU Campus Police 470-578-6666 (tel:+14705786666), a one-line note ("Tapping a button opens your phone's dialer."), and Close / Back to OwlAccess / Escape back to the same page.
- Keyboard: focus starts on the heading (a stray Enter cannot dial), Tab stays inside, focus returns to SOS. No GPS, forms, backend or APIs.
- Tests: 157 pass (10 added in tests/sos.test.tsx; the tel: links are inspected, never clicked).

## 2026-11-20 · 3D (isometric) indoor map, polished
- Materials with one light source: warm room floors, sand hallways (circulation reads first), cool restrooms, light wall panels with crisp tops, door thresholds in tan, elevators as indigo shafts and stairwells as teal shafts, a slab edge and a soft shadow. Floors below shown as slabs 4 m down, joined by the shafts.
- Labels drawn upright at a constant on-screen size: room number in a pill, name underneath; placed by priority (selected rooms, then larger rooms) and never on top of each other, the route or the markers; more names appear as you zoom in. Elevators, stairs, entrances and the ramp have named chips with icons (text, not colour alone).
- Route is the top layer: white casing, done part dashed grey, current step darker and thicker with direction arrows, still-to-go in the route colour. Floor changes get a chip ("Elevator up to Floor 2", "Arrived from Floor 2"); destination and start pins on stems; "You (simulated)" dot with a halo (no pulse with reduced motion).
- Camera: same angle, scale and frame on every floor. Zoom +/−, reset, centre on you; drag to pan, pinch on touch, Ctrl/Cmd + scroll; keyboard arrows, + / −, 0. Floor badge and stack, compass, synthetic-plan chip. Phones: badge row above the drawing, controls in a row.
- Hover or tap a room or feature: one line says what it is. 2D plan kept. No new libraries; routing data and engine unchanged. Tests: 168 pass.
