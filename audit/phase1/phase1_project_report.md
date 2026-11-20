# Phase 1 - Project Inspection Report

Scope: inspection only. No package file and no original GeoJSON was modified (SHA-256 of the three GeoJSON files re-checked: unchanged).
Everything inside the building outline in the indoor package is **SYNTHETIC / MOCK**.

## 1. What files exist

**Original outdoor data** (`/mnt/user-data/uploads/`, read-only)

| File | Content |
|---|---|
| `buildings.geojson` (369 KB, CRS84) | 167 building polygons; 122 named; only 3 carry a `building_id` (BLD001 Academic, BLD002 Design 2, BLD003 Engineering Technology Center) |
| `sidewalks.geojson` (1.1 MB, CRS84) | 700 LineStrings: 671 `footway` (407 sidewalk, 52 crossing, 1 traffic island, rest unspecified) and **29 `steps`** |
| `entrances_ramps.geojson` (4 KB, **EPSG:3857**) | 13 point features: 7 entrances (ENT001-007), 5 ramps (RMP001-005) and 1 malformed row (`feature_id=ENT`, `feature_type=008`); **12 of 13 have `fid` 1-12, the malformed row has `fid = null`** |
| two PDF maps | KSU accessibility map, parking map (reference only) |

**Indoor package** (`/mnt/user-data/outputs/indoor-mapping/`, 35 files in the zip)

| Path | Purpose |
|---|---|
| `buildings/BLD001/floor_1.svg`, `floor_2.svg`, `floor_3.svg` | floor plans (the folder copies carry an embedded C2PA block added at delivery; the copies inside the zip do not, see Phase 2 finding F-06) |
| `rooms.json` (85 records), `nodes.json` (219), `edges.json` (219), `connections.json` (8), `obstacles.json` (6 obstacles, 7 scenarios), `connectors.json` (4), `features.json`, `metadata.json` | structured data |
| `shared/buildings.json`, `building_index.json`, `indoor_schema.json` | building registry (BLD002/BLD003 listed as not generated), JSON Schema |
| `tools/generate_indoor.py`, `write_schema.py`, `validate_and_route.py`, `indoor_routing.py` | generator, schema writer, validator, **Python router** |
| `tools/ts/indoorRouting.ts`, `parity_check.mjs` | **TypeScript router**, parity script |
| `documentation/` | generation notes, coordinate system, accessibility assumptions, **validation report**, **integration guide**, 2 example route SVGs |

**Not present yet:** any React app, any processed outdoor routing graph, any unified graph, any entrance review file.

## 2. How the indoor data is structured

All JSON files are wrapped: `{ schema_version, building_id, synthetic, disclaimer, <collection>: [...] }`.

| File | Records | Key fields |
|---|---|---|
| rooms.json | 85 = 58 navigable rooms + 3 service (non-navigable, no nodes) + 24 hallways (`category: circulation`) | `room_id`, `floor_id`, `room_type`, `x/y/width/height` (bbox, SVG units), `polygon`, `accessible`, `navigable`, `entrance_node_id`, `destination_node_id` |
| nodes.json | 219 (73 per floor): 73 hallway waypoints, 58 room entrances, 43 destinations, 18 intersections, 9 restrooms, 6 elevator, 6 staircase, 4 entrance, 2 ramp | `node_id` (`n_f{floor}_...`), `node_type`, `x`, `y` (SVG units), `room_id`, `accessible` |
| edges.json | 219: 77 hallway, 67 room_interior, 58 door, 6 elevator_door, 6 stair_landing, 3 entrance_threshold, 1 ramp, 1 entrance_steps | `from_node`, `to_node`, `distance` (m), `travel_time` (s), `edge_type`, `accessible`, `stairs_only`, `potentially_narrow`, `obstacle_status` (always `none`), `space_id` |
| connections.json | 8 = 4 elevator + 4 staircase (2 shafts x floors 1-2 and 2-3) | `from_floor`, `to_floor`, `from_node`, `to_node`, `connection_type`, `accessible`, `stairs_only`, `travel_time`, `distance` |
| obstacles.json | 6 obstacles (statuses verified x4, pending x1, resolved x1) + 7 scenarios | location by `location_node_id` or `affected_edge_id` (+ `affected_node_ids` for elevators), `status`, `verified`, `scenario_ids` |
| features.json | 4 entrances, 2 elevators, 2 stairwells, 1 ramp, 64 doors, 6 fountains | per-feature ids matching SVG ids |
| connectors.json | 4, **all `outdoor_node_id = null`** | `indoor_node_id`, `connection_type`, `supported_by_reference`, nearest-sidewalk hint |

ID scopes: `room_*`, `door_*`, node, edge and connection ids are unique building-wide; `elevator_1/2` and `stairwell_1/2` are the same SVG id on every floor (floor-scoped).

## 3. How the routing graph works

- **Graph:** undirected. Each floor has its own subgraph (73 nodes). Floors are joined **only** by `connections.json` (elevator/stair node pairs with identical x/y). No edge crosses floors.
- **Path shape:** room destination node -> `room_entrance` node (on the door) -> hallway waypoint -> corridors/intersections. Building entrances attach to hallway/lobby nodes; the east entrance also passes a ramp edge.
- **Cost:** `travel_time` = distance / speed (hallway 1.2 m/s, door 1.0, ramp 0.8, exterior steps 0.4; x0.85 on "potentially narrow" corridors). Vertical connections: elevator 25 s, stairs 14 s. `distance` is stored separately in meters.
- **Wheelchair mode:** skip edges with `accessible=false` or `stairs_only=true`, connections with `accessible=false`, and nodes with `accessible=false`. Failure returns `NO_ACCESSIBLE_ROUTE` (walking returns `NO_ROUTE`).
- **Obstacles are an overlay, not baked into edges.json.** An obstacle blocks only if `status=="verified"` **and** `verified==true` **and** it is in the active scenario/obstacle list. `edges.json.obstacle_status` stays `none`.
- **Two implementations:** `tools/indoor_routing.py` (heap Dijkstra) and `tools/ts/indoorRouting.ts` (O(n^2) Dijkstra). Same rules, with the differences documented in Phase 2.

## 4. How the SVG coordinate system works

- `viewBox="0 0 680 1120"` on all floors; **10 SVG units = 1 m**; origin top-left; x east, y south; north up, no rotation.
- Local meters (y north, from the footprint's south-west bounding-box corner) map as `svg_x = 150 + 10*xm`, `svg_y = 110 + 10*(90 - ym)`. Node, room, door and edge coordinates all use this single frame, and JSON/SVG agree (audited).
- Groups per floor: `layer_footprint`, `layer_hallways`, `layer_rooms`, `layer_walls_interior`, `layer_walls_exterior`, `layer_doors`, `layer_stairs`, `layer_elevators`, `layer_ramps`, `layer_accessibility`, `layer_obstacles` (static, all demo obstacles), `layer_labels`, `layer_nav_graph` (hidden debug), **`route_layer` (empty, for polylines)**, `layer_legend`.
- Footprint = the 25 vertices of the BLD001 polygon (SW-corner origin, flat-earth scaling, see finding F-05 for the scale constant).

## 5. How the indoor and outdoor datasets can be connected (guide verified against the files)

Target chain: `outdoor sidewalk node -> connector -> indoor entrance node (n_f1_entrance_k) -> indoor graph`.

What the data supports today:

| Needed | Status |
|---|---|
| Indoor entrance nodes | exist (4) on the exterior wall, 0.0-0.04 m from the raw footprint wall |
| Outdoor graph nodes | **do not exist**: sidewalks are plain LineStrings with `id` = `way/...`, no node ids |
| Entrance source points | 3 for BLD001: ENT006 (9.4 m from footprint), ENT007 (4.4 m), RMP004 (2.4 m), all `verified=false` |
| Entrance 4 | synthetic, unsupported - must never become a real connection |
| Coordinate systems | entrances file is **EPSG:3857**, buildings and sidewalks are CRS84: must be reprojected, not mixed |

Preview of outdoor-graph readiness (details belong to Phase 4):

- 700 lines, 3,272 distinct vertices, 825 vertices shared by two or more ways (junctions exist in the data).
- Connectivity by shared vertices: **26 components** (largest 2,015 vertices, next 805, 138, 81...). Not one network.
- 3 line pairs cross without a shared vertex (probably bridge/tunnel/layer separations: 6 `bridge`, 2 `tunnel`, 15 `layer` tags) and must not be auto-joined.
- Accessibility attributes are sparse: `highway=steps` (29), `incline` (7), `ramp` (2), `step_count` (1), `tactile_paving` (2), `surface` (488); no `wheelchair` tag anywhere. Outdoor wheelchair exclusion can rely on `steps` only; everything else is unknown, not accessible.
- The guide's nearest-sidewalk hints are **correct** (way ids and distances reproduced): ENT006 -> `way/1484121410` 4.4 m, ENT007 -> `way/225470267` 0.1 m, RMP004 -> `way/335766008` 2.7 m, all `footway` (none are `steps`). A nearest line is a hint, not proof that the entrance connects there.

What the integration guide gets wrong or leaves out (verified): see Phase 2, findings F-04 (non-compiling snippet; no CRS, steps, ENT008 or C2PA warnings).
