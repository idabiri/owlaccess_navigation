# Phase 8 – End-to-end test results

All indoor data is **SYNTHETIC / MOCK**; the outdoor→indoor link (ENT007 → `entrance_2`) is **provisional, not field-verified**. Each scenario ran on the Python router and on the TypeScript router; results are identical in every case.

Results here are routing-level scenarios plus component tests in jsdom (`app/tests/ui.test.tsx`, 9 tests). **No real browser was available**, so pixel rendering, SVG CSS and pointer behaviour in Chrome/Safari/Firefox are not tested.

| ID | Start node | Destination node | Mode | Scenario | Expected | Actual | Python = TS | Pass |
|---|---|---|---|---|---|---|---|---|
| E2E-01 Outdoor sidewalk -> building entrance | `on_9e09c97887` | `entrance_2` | walking | none | route found; floors 1; uses conn_out_entrance_2 | found, 130.5 s / 167 m, stairs=False, elevator=False, floors=['1'], obstacles applied=none | yes | PASS |
| E2E-02 Entrance -> Floor 1 classroom | `entrance_2` | `room_102` | walking | none | route found; uses_stairs=False; uses_elevator=False; floors 1 | found, 54.6 s / 64 m, stairs=False, elevator=False, floors=['1'], obstacles applied=none | yes | PASS |
| E2E-03 Floor 1 classroom -> Floor 2 classroom | `room_102` | `room_212` | walking | none | route found; floors 1,2 | found, 60.8 s / 60 m, stairs=True, elevator=False, floors=['1', '2'], obstacles applied=none | yes | PASS |
| E2E-04 Floor 2 -> Floor 3 using the elevator (wheelchair) | `room_212` | `room_312` | wheelchair | none | route found; uses_stairs=False; uses_elevator=True; floors 2,3 | found, 93 s / 83.5 m, stairs=False, elevator=True, floors=['2', '3'], obstacles applied=none | yes | PASS |
| E2E-05 Verified blocked hallway forces a reroute (walking) | `room_111` | `room_117` | walking | SCN-BLOCKED-HALLWAY | route found; avoids e_f1_051; slower than unblocked baseline; obstacles applied OBS-001 | found, 56.5 s / 65 m, stairs=False, elevator=False, floors=['1'], obstacles applied=['OBS-001'] | yes | PASS |
| E2E-06 Wheelchair mode never uses stairs | `room_102` | `room_302` | wheelchair | none | route found; uses_stairs=False; uses_elevator=True; walking baseline uses stairs | found, 129.7 s / 102 m, stairs=False, elevator=True, floors=['1', '2', '3'], obstacles applied=none | yes | PASS |
| E2E-07 Elevator 1 out of service -> elevator 2 used (wheelchair) | `room_102` | `room_302` | wheelchair | SCN-ELEVATOR-1-OUT | route found; uses_stairs=False; avoids elevator 1; uses elevator 2; obstacles applied OBS-002 | found, 129.7 s / 102 m, stairs=False, elevator=True, floors=['1', '2', '3'], obstacles applied=['OBS-002'] | yes | PASS |
| E2E-08 Both elevators out -> NO_ACCESSIBLE_ROUTE (wheelchair); walking still has stairs | `room_102` | `room_302` | wheelchair | SCN-NO-ELEVATOR | no route (NO_ACCESSIBLE_ROUTE); obstacles applied OBS-002,OBS-003; walking baseline uses stairs | found=false, reason=NO_ACCESSIBLE_ROUTE, obstacles applied=['OBS-002', 'OBS-003'] | yes | PASS |
| E2E-09 Indoor start (Floor 3) -> outdoor destination | `room_302` | `on_9e09c97887` | walking | none | route found; floors 1,2,3; uses conn_out_entrance_2 | found, 221.1 s / 251 m, stairs=True, elevator=False, floors=['1', '2', '3'], obstacles applied=none | yes | PASS |
| E2E-10 Unverified obstacle must NOT change the route | `room_102` | `room_302` | wheelchair | SCN-UNVERIFIED-ONLY | route found; identical to no-obstacle route; obstacles applied none | found, 129.7 s / 102 m, stairs=False, elevator=True, floors=['1', '2', '3'], obstacles applied=none | yes | PASS |

## Component tests (vitest + Testing Library, jsdom)

- starts on outdoor map, synthetic banner shown, Calculate disabled until both ends chosen
- outdoor→indoor route: results shown, map switches Outdoor → Floor 1 → Floor 2 via Next, floor-transition list shown
- route polyline is drawn into `#route_layer` on the active floor
- floor tabs switch maps
- clicking a room selects it as destination / start
- wheelchair mode forces Avoid stairs and uses the elevator
- `NO_ACCESSIBLE_ROUTE` message when both elevators are out; turning off *Avoid verified obstacles* restores the route
- accessibility limitations list contains synthetic/provisional caveats

Run: `cd app && npm install && npm test` (20 tests: 11 routing scenarios incl. results writer, 9 UI). Python: `python3 integration/e2e/run_e2e.py`.

Known test limits: E2E-01/09 use one outdoor node (`on_9e09c97887`) on the Marietta main sidewalk component; only `entrance_2` has an outdoor connector, so other entrances cannot be reached from outdoors yet.
