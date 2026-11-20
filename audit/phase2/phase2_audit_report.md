# Phase 2 - Audit Report: Indoor Mapping Package (BLD001)

> Independent audit. The audit scripts read the raw files and do **not** import the package's own validator or generator (`audit/audit_phase2.py`, `audit_routing.py`, plus Node scripts). Nothing in the package or the original GeoJSON was modified. Everything inside the building outline is **SYNTHETIC / MOCK**.

## Headline

- **Static audit (SVG, JSON, provenance, doc claims): 91 pass, 1 warning, 0 fail**, 6 informational notes.
- **DOM load test (jsdom + xmllint): 25 pass, 0 fail, 3 inconclusive** (tool limitation, explained below). No real browser engine was available here, so this is a substitute, not a browser test.
- **Routing:** 26,474 routes (every pair of 62 endpoints x 2 modes x 7 scenarios) compared across Python, TypeScript and an independent networkx implementation. Python agrees with the independent reference on **all 26,474**; the two shipped routers choose **identical paths in all of them** but differ in rounded totals in **762 (2.9%)** (finding F-02). **17/17** named scenarios pass.
- **Package validator reproduces 64/64** on a clean copy; **JSON and SVG files are reproducible** from the generator (byte-identical, SVGs after removing an embedded C2PA block).
- **12 findings** below. None invalidates the indoor graph. The most important are **F-01** (TypeScript router fails open on unknown obstacle/scenario ids) and **F-02/F-03** (Python/TypeScript inconsistency, and the package's claim of identical results is only true for the 17 cases it tested). Nothing has been changed; proposed fixes await your approval.

## Findings (nothing fixed yet)

| ID | Severity | Finding | Evidence | Proposed action | Needs your approval |
|---|---|---|---|---|---|
| F-01 | High | TypeScript router **fails open** on unknown ids | `route(d,a,b,{scenario:'SCN-TYPO'})` and `{obstacleIds:['OBS-999']}` silently apply no obstacles and return a route through a verified-blocked hallway. Python raises `KeyError`. A typo or stale id would hide a verified obstacle. | Throw (or return an error result) on unknown scenario/obstacle ids in TS, matching Python. Add tests. | Yes (edits `indoorRouting.ts`) |
| F-02 | Medium | Python vs TypeScript rounding differs | Python `round()` is half-to-even (24.25 -> 24.2), JS `toFixed` is half-up (-> 24.3). 762 of 26,474 routes differ: 756 by 0.1 s, 6 by 0.1 m. **Paths are identical in all routes.** The earlier "0 mismatches" held only for 17 hand-picked cases. | Sum in integer hundredths and round half-up in both languages (or return unrounded values and round for display). | Yes (both routers) |
| F-03 | Medium | Parity claim not reproducible | `tools/ts/parity_check.mjs` only prints TypeScript output; the Python comparison I ran earlier was an inline snippet that was never shipped. The script also hard-codes `/mnt/user-data/...`. The validation report's 'reproduce' instruction therefore cannot reproduce a comparison. | Ship a comparison harness (the audit's `audit_routing.py` + a Node exporter can serve), parameterize paths, correct the report wording. | Yes (adds/changes files) |
| F-04 | Medium | Integration guide inaccuracies | The `Floor` component snippet does **not compile** under `tsc --strict` (missing `useRef`, `useEffect`, `IndoorData`, `RouteResult`, `routePointsForFloor` imports); adding the imports fixes it (verified). The guide and notes also omit: entrances file is EPSG:3857 vs CRS84 elsewhere; sidewalks contain 29 `steps` ways; the ENT008 row is malformed (`fid` null); SVGs carry a C2PA block. (The ENT008 and CRS issues were mentioned in my chat replies, **not** in the package documents.) | Correct the snippet; add a 'data caveats' section. | Yes (edits docs) |
| F-05 | Low-Med | Footprint / georeference scale constant | The generator used 110,574 m per degree of latitude (an equatorial value); at this latitude it is about 110,921 (0.31% off). Footprint vertices deviate from the raw polygon by up to **0.32 m** (reproduced and fully explained: after rescaling the deviation drops below 0.12 m). E-W error is 0.10%. Indoor routing is unaffected (it is self-consistent); distances quoted in meters for entrance offsets are ~0.3% low N-S (ENT006: 9.4 m, not 9.3). `georeference_hint` round-trips to the raw lon/lat but uses the same constants. | Do **not** regenerate. For map placement, fit a similarity transform from the 25 footprint vertices to the raw polygon (residual about 0.1 m) in the integration layer; compute all outdoor distances geodesically. | Decision (no change proposed to indoor files) |
| F-06 | Info | Embedded C2PA manifests in SVGs | Each of the 3 floor SVGs (and the 2 example SVGs) contains a signed `<c2pa:manifest>` in `<metadata>` (about 7.7 KB; 'Claude provided this file at the request of a user', claim generator 'Anthropic Files'). It was **not written by my generator**; it appears only in the SVG files that were delivered individually. **The SVGs inside `indoor-mapping.zip` do not have it**; after removing the block, folder and zip SVGs are byte-identical. It appears only in SVGs, not JSON/MD/code. It is hash-bound to the file content: hand-editing or re-saving an SVG will invalidate it. Rendering is unaffected. | Keep as is. If you need to edit SVGs, expect the credential to no longer validate. Strip it only if you decide you don't want it. | Decision |
| F-07 | Low | SVG embedding hazards | Inlining all 3 floors in one document creates 34 duplicate ids; embedded `<style>` uses unprefixed global class names; `<use href>` is SVG 2 (fine in current browsers). The guide's 'one floor at a time' warning is correct. | React component renders one floor at a time and namespaces classes (Phase 7). | No |
| F-08 | Low | metadata count semantics | `metadata.counts.rooms = 58` counts navigable rooms only; `rooms.json` has 85 records (58 + 3 service + 24 hallways). | Document it. | Yes (docs) |
| F-09 | Info | Obstacle overlay design | `edges.json.obstacle_status` is always `none`; obstacles live only in `obstacles.json`. A consumer reading edges alone sees no obstacles. SVG `layer_obstacles` is static. | Unified graph must apply the overlay explicitly (Phase 6). | No |
| F-10 | Info | Routing resilience | Blocked-hallway scenario reroutes all 1,485 reachable wheelchair pairs (no new isolations). But the graph is mostly tree-like: 167 bridge edges, 129 articulation nodes, so most other single blockages would isolate rooms. | Add redundancy only if the demo needs more reroute scenarios. | No |
| F-11 | Info | Latent tie-breaking difference | Python (heap, node-id tie order) and TypeScript (linear scan) break equal-cost ties differently. Observed path differences in 26,474 routes: **0**, but nothing guarantees it for future data. | Define a deterministic tie-break in both. | Yes (both routers) |
| F-12 | Data | Source data quirks (not package bugs) | ENT008 row: `feature_id='ENT'`, `feature_type='008'`, `fid=null` (hand-edited row). Typos: 'Accessiblity' (ENT002 source), 'Design2' (ENT003), 'indentified' (ENT001 note). Carried into Phase 3. | Handle in the entrance review. | - |

## 1. SVG audit

All three floors: well-formed XML (xmllint), identical `viewBox`/units/origin, identical footprint path (also equal to the exterior wall path and to `buildings.json`), no `<script>`/`<image>`/external URLs/event handlers (the only non-W3C URL is the C2PA namespace), one empty `route_layer` each, no duplicate ids per file, every `<use>` resolves. Room/hallway ids, doors, entrances, obstacles, fountains and hidden nav-graph circles/lines match JSON **in both directions**; SVG path geometry equals the `polygon` in `rooms.json`; elevator shafts identical on every floor. Footprint vs the **raw** GeoJSON: see F-05 (the only warning).

## 2. JSON audit

Ids unique in scope; every edge references existing nodes, stays on one floor, has no self-loop/duplicate, and its `distance` equals the Euclidean node distance (+-0.01 m) and `travel_time` equals distance / documented speed; flag consistency holds (stairs_only edges inaccessible, ramp edges accessible). Every node lies inside the footprint built from the raw polygon; entrance nodes are 0.00-0.04 m from the wall; destination/restroom/staircase nodes lie inside their room; room entrance nodes lie on their room boundary; every navigable room has an entrance node with a door edge to a hallway/circulation node; the 3 service rooms have no nodes (documented). All 8 vertical connections join same-type, same-x/y nodes on adjacent floors; elevators accessible, stairs `accessible=false, stairs_only=true`; every elevator/stair node is covered. Obstacles reference valid nodes/edges on their own floor; scenario references are consistent both ways. Whole graph is one component; wheelchair subgraph is one component (206 nodes; the other 13 nodes are stair/steps-only).

## 3. DOM load test (jsdom)

All floors parse as `image/svg+xml`, expose `#route_layer`, survive the guide's `innerHTML` embedding with the same ids, and accept the guide's `route_layer.innerHTML = '<polyline .../>'` step (element created in the SVG namespace). **Inconclusive (3):** jsdom ignores `<style>` inside inline SVG, so it reports the debug layer as visible; the identical rule hides it when hoisted into an HTML `<style>`, and cairosvg honours it as shipped. Real-browser rendering was not tested.

## 4. Routing audit

Endpoints: 4 entrances + 58 navigable rooms = 62; 26,474 routes. Results:

| Check | Result |
|---|---|
| Python vs independent reference (found/not found, cost +-0.01 s) | agree on all 26,474 |
| Python vs TypeScript: found/reason, nodes, links | identical on all 26,474 (0 path differences) |
| Python vs TypeScript: rounded time/distance | **762 differ** by 0.1 (rounding, F-02) |
| Every path link exists in the active graph (no blocked/forbidden link used); cost recomputed from links matches | pass for all |
| Wheelchair routes never use stairs or inaccessible nodes | pass for all |
| Pairs changed by `SCN-UNVERIFIED-ONLY` / `SCN-RESOLVED-IGNORED` | 0 |
| Asymmetric results in 400 random reversed pairs | 0 |

Scenario impact (pairs found / no route, of 1,891):

| Scenario | Walking | Wheelchair |
|---|---|---|
| SCN-NORMAL | 1891 / 0 | 1485 / 406 |
| SCN-BLOCKED-HALLWAY | 1891 / 0 | 1485 / 406 |
| SCN-ELEVATOR-1-OUT | 1891 / 0 | 1485 / 406 |
| SCN-NO-ELEVATOR | 1891 / 0 | 477 / 1414 |
| SCN-CONSTRUCTION | 1830 / 61 | 1431 / 460 |
| SCN-UNVERIFIED-ONLY | 1891 / 0 | 1485 / 406 |
| SCN-RESOLVED-IGNORED | 1891 / 0 | 1485 / 406 |

Normal wheelchair mode has 406 no-route pairs by design: 7 endpoints (6 stairwell rooms + the steps entrance) are inaccessible.

### Named scenarios (endpoints differ from the package's own tests)

| ID | Scenario | Start (node) | Goal (node) | Mode | Obstacle scenario | Expected / actual | Time s | Dist m | Passed |
|---|---|---|---|---|---|---|---|---|---|
| A-01 | room-to-room, same floor: room_104 -> room_113 | room_104 (`n_f1_dest_104`) | room_113 (`n_f1_dest_113`) | walking | none | FOUND | 11.3 | 13.0 | PASS |
| A-02 | room-to-room, same floor F3: room_303 -> room_317 | room_303 (`n_f3_dest_303`) | room_317 (`n_f3_dest_317`) | wheelchair | none | FOUND | 42.2 | 50.0 | PASS |
| A-03 | entrance-to-room: entrance_2 -> room_115 (walking) | entrance_2 (`n_f1_entrance_2`) | room_115 (`n_f1_dest_115`) | walking | none | FOUND | 19.5 | 20.8 | PASS |
| A-04 | entrance-to-room: entrance_3 (ramp) -> room_113 (wheelchair) | entrance_3 (`n_f1_entrance_3`) | room_113 (`n_f1_dest_113`) | wheelchair | none | FOUND | 24.4 | 27.6 | PASS |
| A-05 | floor-to-floor: room_103 -> room_212 (walking) | room_103 (`n_f1_dest_103`) | room_212 (`n_f2_dest_212`) | walking | none | FOUND | 70.8 | 72.0 | PASS |
| A-06 | floor-to-floor via elevator: room_103 -> room_212 (wheelchair) | room_103 (`n_f1_dest_103`) | room_212 (`n_f2_dest_212`) | wheelchair | none | FOUND | 88.8 | 78.5 | PASS |
| A-07 | F2 -> F3 via elevator: room_219 -> room_315 (wheelchair) | room_219 (`n_f2_dest_219`) | room_315 (`n_f3_dest_315`) | wheelchair | none | FOUND | 93.3 | 82.7 | PASS |
| A-08 | F1 -> F3 two hops: entrance_1 -> room_301 (wheelchair) | entrance_1 (`n_f1_entrance_1`) | room_301 (`n_f3_dest_301`) | wheelchair | none | FOUND | 145.2 | 120.3 | PASS |
| A-09 | blocked hallway reroute (walking): room_111 -> room_117 under OBS-001 | room_111 (`n_f1_dest_111`) | room_117 (`n_f1_dest_117`) | walking | SCN-BLOCKED-HALLWAY | FOUND | 56.5 | 65.0 | PASS |
| A-10 | blocked hallway reroute (wheelchair): room_111 -> room_117 | room_111 (`n_f1_dest_111`) | room_117 (`n_f1_dest_117`) | wheelchair | SCN-BLOCKED-HALLWAY | FOUND | 56.5 | 65.0 | PASS |
| A-11 | one elevator unavailable: room_105 -> room_305 (wheelchair) | room_105 (`n_f1_dest_105`) | room_305 (`n_f3_dest_305`) | wheelchair | SCN-ELEVATOR-1-OUT | FOUND | 59.5 | 19.0 | PASS |
| A-12 | both elevators unavailable: entrance_2 -> room_301 (wheelchair) -> NO_ACCESSIBLE_ROUTE | entrance_2 (`n_f1_entrance_2`) | room_301 (`n_f3_dest_301`) | wheelchair | SCN-NO-ELEVATOR | NO_ACCESSIBLE_ROUTE | None | None | PASS |
| A-13 | both elevators unavailable, walking uses stairs: entrance_2 -> room_301 | entrance_2 (`n_f1_entrance_2`) | room_301 (`n_f3_dest_301`) | walking | SCN-NO-ELEVATOR | FOUND | 106.5 | 103.0 | PASS |
| A-14 | no accessible route from the steps entrance: entrance_4 -> room_119 (wheelchair) | entrance_4 (`n_f1_entrance_4`) | room_119 (`n_f1_dest_119`) | wheelchair | none | NO_ACCESSIBLE_ROUTE | None | None | PASS |
| A-15 | unverified blocked doorway must not block: room_104 -> room_103 | room_104 (`n_f1_dest_104`) | room_103 (`n_f1_dest_103`) | wheelchair | SCN-UNVERIFIED-ONLY | FOUND | 17.6 | 20.5 | PASS |
| A-16 | verified construction isolates room_119 (walking) -> NO_ROUTE | entrance_1 (`n_f1_entrance_1`) | room_119 (`n_f1_dest_119`) | walking | SCN-CONSTRUCTION | NO_ROUTE | None | None | PASS |
| A-17 | stairwell destination is not reachable in wheelchair mode | entrance_1 (`n_f1_entrance_1`) | room_109 (`n_f1_stair_1`) | wheelchair | none | NO_ACCESSIBLE_ROUTE | None | None | PASS |

## 5. Python vs TypeScript - documented differences

| # | Difference | Impact |
|---|---|---|
| 1 | Rounding: half-even (Python `round`) vs half-up (JS `toFixed`) | 0.1 s/0.1 m in 2.9% of routes (F-02) |
| 2 | Unknown scenario/obstacle id: Python raises, TS ignores | **TS fails open** (F-01) |
| 3 | Python `route(cost=...)` can optimize `distance`; TS always uses `travel_time` | feature gap (needed in Phase 6) |
| 4 | Tie-breaking: heap vs linear scan | none observed (F-11) |
| 5 | Result shape: snake_case + `total_cost` vs camelCase, no `total_cost`; TS failure result has no `nodes`/`links` | adapter needed |
| 6 | Same start/goal returns found, 0 s, 1 node in both; unknown endpoint throws in both; dangling refs ignored in both | consistent |

## 6. Integration guide verified against the files

| Guide statement | Verdict |
|---|---|
| Files to copy / data loader (`features.features.entrances`, collection keys) | correct; snippet compiles |
| `route(...)` usage and result shape | correct; compiles |
| `Floor` component snippet | **does not compile as written** (missing imports); compiles once added (F-04) |
| `svgnode_<node_id>`, `data-room-type`, ids match JSON | correct |
| One floor at a time (duplicate ids) | correct (34 duplicates) |
| Connector table: ENT006/ENT007/RMP004 sidewalk ways and distances | correct (4.4 / 0.1 / 2.7 m; all `footway`) |
| `outdoor_node_id` empty because sidewalks have no node ids | correct (ids are `way/...` only) |
| `georeference_hint` is approximate, no rotation | correct, but built on a 0.31% N-S scale error (F-05) |
| 'Reproduce parity with `parity_check.mjs`' (validation report) | **not reproducible** as a comparison (F-03) |
| 'Validator 64/64' | reproduced on a clean copy |
| Missing from the docs | CRS mismatch, 29 `steps` ways, ENT008 row, C2PA block |

## 7. What was not verified

- Real-browser rendering (no Chromium/Playwright here). Visual plausibility of layouts is a human judgement; I only re-confirmed geometry/overlap rules.
- The React snippets beyond type-checking. No accessibility ground truth exists: all accessibility flags remain synthetic and unverified.
- Outdoor graph quality (Phase 4).

## 8. Audit artifacts

`audit/audit_phase2.py` (+`phase2_static_results.json`), `audit/audit_routing.py` (+`phase2_routing_results.json`), `audit/browser_dom_results.json`, `phase1_project_report.md`. Node helper scripts (jsdom load test, all-routes TypeScript run) ran from a temp directory; their logic is summarized above and I can add them to `audit/` on request.

### Full static check list

| ID | Check | Status | Detail |
|---|---|---|---|
| P-01 | Original GeoJSON files unchanged since first inspection (SHA-256) | PASS | True |
| S-XML-F1 | floor_1.svg is well-formed XML (xmllint) | PASS |  |
| S-SAFE-F1 | floor_1.svg has no <script>, <image>, external URLs or event handlers | PASS |  |
| S-XML-F2 | floor_2.svg is well-formed XML (xmllint) | PASS |  |
| S-SAFE-F2 | floor_2.svg has no <script>, <image>, external URLs or event handlers | PASS |  |
| S-XML-F3 | floor_3.svg is well-formed XML (xmllint) | PASS |  |
| S-SAFE-F3 | floor_3.svg has no <script>, <image>, external URLs or event handlers | PASS |  |
| S-VB | All floors share the same viewBox / width / height | PASS | {1: '0 0 680 1120', 2: '0 0 680 1120', 3: '0 0 680 1120'} |
| S-UNITS | data-units-per-meter = 10 and data-origin = top-left on every floor | PASS |  |
| S-DUPID | No duplicate ids inside any single SVG file | PASS |  |
| S-ROUTE | Exactly one empty <g id=route_layer> per floor | PASS |  |
| S-FP-SAME | Identical exterior footprint path on all 3 floors | PASS |  |
| S-FP-RAW | SVG footprint vertices match raw buildings.geojson polygon (independent ENU transform) within 0.25 m | WARN | 25 vs 25 vertices; max deviation 0.324 m |
| S-FP-SCALE | Deviation is explained by the generator's metres-per-degree constants (110574 m/deg lat is the equatorial value; ~110921 at this latitude) | PASS | after rescaling by x1.00102, y1.00314: max deviation 0.065 m (was 0.324 m) |
| S-FP-EXT | Exterior wall path equals footprint path | PASS |  |
| S-ROOMS-F1 | F1: SVG room_/hallway_ ids == JSON room ids (both directions) | PASS | json-only [] svg-only [] |
| S-LABEL-F1 | F1: every non-hallway room has a label group | PASS |  |
| S-WALL-F1 | F1: every room has an interior wall outline | PASS |  |
| S-DOOR-F1 | F1: SVG door_* ids == features.json doors | PASS |  |
| S-ENT-F1 | F1: SVG entrance_* ids == features.json entrances | PASS | ['entrance_1', 'entrance_2', 'entrance_3', 'entrance_4'] vs ['entrance_1', 'entrance_2', 'entrance_3', 'entran |
| S-OBS-F1 | F1: SVG obstacle_* ids == obstacles.json for that floor | PASS |  |
| S-NODE-F1 | F1: hidden nav-graph layer has one circle per node, at the node's x/y | PASS |  |
| S-EDGE-F1 | F1: hidden nav-graph layer has one line per edge | PASS |  |
| S-FOUN-F1 | F1: fountain ids match | PASS |  |
| S-USE-F1 | F1: every <use> references an existing symbol | PASS | 7 <use> |
| S-POLY-F1 | F1: SVG path geometry == rooms.json polygon | PASS | [] |
| S-ROOMS-F2 | F2: SVG room_/hallway_ ids == JSON room ids (both directions) | PASS | json-only [] svg-only [] |
| S-LABEL-F2 | F2: every non-hallway room has a label group | PASS |  |
| S-WALL-F2 | F2: every room has an interior wall outline | PASS |  |
| S-DOOR-F2 | F2: SVG door_* ids == features.json doors | PASS |  |
| S-ENT-F2 | F2: SVG entrance_* ids == features.json entrances | PASS | [] vs [] |
| S-OBS-F2 | F2: SVG obstacle_* ids == obstacles.json for that floor | PASS |  |
| S-NODE-F2 | F2: hidden nav-graph layer has one circle per node, at the node's x/y | PASS |  |
| S-EDGE-F2 | F2: hidden nav-graph layer has one line per edge | PASS |  |
| S-FOUN-F2 | F2: fountain ids match | PASS |  |
| S-USE-F2 | F2: every <use> references an existing symbol | PASS | 3 <use> |
| S-POLY-F2 | F2: SVG path geometry == rooms.json polygon | PASS | [] |
| S-ROOMS-F3 | F3: SVG room_/hallway_ ids == JSON room ids (both directions) | PASS | json-only [] svg-only [] |
| S-LABEL-F3 | F3: every non-hallway room has a label group | PASS |  |
| S-WALL-F3 | F3: every room has an interior wall outline | PASS |  |
| S-DOOR-F3 | F3: SVG door_* ids == features.json doors | PASS |  |
| S-ENT-F3 | F3: SVG entrance_* ids == features.json entrances | PASS | [] vs [] |
| S-OBS-F3 | F3: SVG obstacle_* ids == obstacles.json for that floor | PASS |  |
| S-NODE-F3 | F3: hidden nav-graph layer has one circle per node, at the node's x/y | PASS |  |
| S-EDGE-F3 | F3: hidden nav-graph layer has one line per edge | PASS |  |
| S-FOUN-F3 | F3: fountain ids match | PASS |  |
| S-USE-F3 | F3: every <use> references an existing symbol | PASS | 3 <use> |
| S-POLY-F3 | F3: SVG path geometry == rooms.json polygon | PASS | [] |
| S-ALIGN-elevator_1 | elevator_1 rect identical on floors 1-3 | PASS |  |
| S-ALIGN-elevator_2 | elevator_2 rect identical on floors 1-3 | PASS |  |
| S-INLINE | Ids duplicated if all three floors were inlined in one HTML document | INFO | 34 duplicate ids (e.g. ['hatch_gray', 'hatch_red', 'hatch_ramp', 'sym_wheelchair', 'sym_steps']) -> guide's 'o |
| P-C2PA | SVG files carry an embedded C2PA Content Credentials manifest (<metadata>), ~7.7 KB each; not written by generate_indoor.py | INFO | svg floors: {1: True, 2: True, 3: True}; non-SVG files containing 'c2pa': [] |
| P-REGEN-RUN | generate_indoor.py runs from the package into a TEMP folder (package untouched) | PASS |  |
| P-REGEN-DIFF | Delivered JSON and SVG files are byte-identical to a fresh generator run (SVGs compared after removing the C2PA block) | PASS | [] |
| J-UNIQ-rooms | rooms: ids unique | PASS | 85 |
| J-UNIQ-nodes | nodes: ids unique | PASS | 219 |
| J-UNIQ-edges | edges: ids unique | PASS | 219 |
| J-UNIQ-connections | connections: ids unique | PASS | 8 |
| J-UNIQ-obstacles | obstacles: ids unique | PASS | 6 |
| J-UNIQ-doors | doors: ids unique | PASS | 64 |
| J-UNIQ-connectors | connectors: ids unique | PASS | 4 |
| J-UNIQ-feat | features.json: ids unique per collection | PASS |  |
| J-EDGE-REF | Every edge references existing nodes | PASS |  |
| J-EDGE-SELF | No self-loop or zero-length edges | PASS |  |
| J-EDGE-DUP | No duplicate edges between the same node pair | PASS | [] |
| J-EDGE-FLOOR | Edges stay within one floor and match floor_id | PASS |  |
| J-EDGE-DIST | Edge distance == Euclidean node distance / 10 (+-0.01 m) | PASS |  |
| J-EDGE-TIME | travel_time == distance / documented speed (x0.85 if narrow) | PASS | [] |
| J-EDGE-FLAGS | Flag consistency: stairs_only edges are inaccessible; entrance_steps/stair_landing are stairs_only; ramp edges accessible | PASS |  |
| J-NODE-FLOOR | Node floor_id exists in metadata | PASS |  |
| J-NODE-IN | Every node inside (or <=0.3 m from) the footprint built from the RAW geojson | PASS | [] |
| J-ENT-ONWALL | Entrance nodes: distance to raw footprint wall (m) | INFO | {'n_f1_entrance_1': 0.04, 'n_f1_entrance_2': 0.03, 'n_f1_entrance_3': 0.0, 'n_f1_entrance_4': 0.03} |
| J-DEST-IN | Destination / restroom / staircase nodes lie inside their own room polygon | PASS | [] |
| J-ENTR-WALL | room_entrance nodes lie on their room's boundary | PASS | [] |
| J-ROOM-ENTR | Every navigable room: entrance_node_id & destination_node_id exist, entrance node belongs to the room, entrance has a door edge to a hallway/circulati | PASS | 58 navigable rooms |
| J-SERVICE | Non-navigable service rooms have no nodes (documented exception) | PASS | ['room_110', 'room_210', 'room_310'] |
| J-CONN | Vertical connections: valid nodes, adjacent floors, same type, same x/y | PASS | [] |
| J-CONN-COUNT | 4 elevator + 4 stair connections (2 shafts x 2 floor hops each) | PASS |  |
| J-CONN-FLAGS | Elevator: accessible, not stairs_only. Staircase: inaccessible, stairs_only | PASS |  |
| J-CONN-ALLFLOORS | Every elevator/stair node on floors 1-3 is covered by a connection | PASS |  |
| J-OBS-REF | Every obstacle references an existing node/edge on its own floor | PASS | [] |
| J-OBS-SCEN | Scenario<->obstacle references are consistent in both directions | PASS |  |
| J-OBS-SYNTH | All obstacles synthetic and prefixed as demo data | PASS |  |
| J-SYNTH | Every record: synthetic=true and verified=false (except obstacles that are explicitly verified demo data) | PASS |  |
| J-META-COUNT | metadata.json counts equal actual counts | PASS | metadata.rooms=58 but rooms.json has 85 records (rooms+service+hallways) |
| J-META-NOTE | 'rooms' count semantics | INFO | metadata.rooms counts category=='room' only (58); rooms.json holds 85 records incl. 3 service and 24 hallways |
| J-META-OSM | metadata.source.osm_id equals the raw feature's id | PASS | way/225446888 |
| J-INDEX | building_index lists BLD001 generated, BLD002/BLD003 not generated | PASS |  |
| J-GEOREF | georeference_hint round-trips the footprint back to the raw lon/lat (<=0.25 m) | PASS | max error 0.065 m |
| J-GRAPH-CONN | Full indoor graph is one connected component | PASS | 219 nodes / 227 links |
| J-GRAPH-WC | Wheelchair-accessible subgraph components | INFO | 1 comps; main=206 nodes; others=[] |
| J-SPOF | Wheelchair graph single points of failure (articulation points / bridges) | INFO | 129 articulation nodes, 167 bridge edges (many are expected leaf rooms/doors) |
| C-ENT-connector-parity | Doc claim holds: ENT/connector parity | PASS |  |
| C-fountains-2-per-floor | Doc claim holds: fountains 2 per floor | PASS |  |
| C-narrow-edges-are-hallway_2-8-f | Doc claim holds: narrow edges are hallway_2/8 families only | PASS |  |
| C-doors-1-2-m-lobby-elev-lobby-3 | Doc claim holds: doors 1.2 m / lobby+elev lobby 3.0 m | PASS |  |
| C-connectors-all-outdoor_node_id | Doc claim holds: connectors: all outdoor_node_id null | PASS |  |
| C-accessible-entrances-1-3-entra | Doc claim holds: accessible entrances 1-3, entrance_4 steps | PASS |  |