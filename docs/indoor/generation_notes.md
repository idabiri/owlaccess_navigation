# Generation Notes - BLD001 (H, Academic Building)

> **SYNTHETIC / MOCK DATA.** Only the exterior outline comes from your data. Every room, wall, door, elevator, stair,
> ramp, restroom, accessibility flag and obstacle is invented for prototyping. Nothing here is an official KSU plan and
> nothing has been field-verified.

## Scope (as approved)
- **Generated:** BLD001 `H - Academic Building`, three floors (OSM lists `building:levels = 3`).
- **Skipped on request:** BLD002 `I2 - Design 2` and BLD003 `Q - Engineering Technology Center` (`indoor_mapping = False`). They are listed in `shared/building_index.json` with `indoor_generated: false`.
- **Scale:** 1 SVG unit = 0.1 m (10 units = 1 m), as approved.

## What is known vs. simulated
| Item | Status | Source |
|---|---|---|
| Exterior footprint (25 vertices, ~32 x 90 m, long N-S bar) | **Approximate, real** | `buildings.geojson` feature `way/225446888` (OSM-derived). Vertices rounded to 0.1 m, none removed or simplified. |
| Building position/orientation, north-up | Real, approximate | Same polygon. No rotation applied. Compared qualitatively with the KSU accessibility map and parking map. |
| Entrances: `entrance_1`, `entrance_2`, `entrance_3` | **Position only loosely supported** | `ENT006`, `ENT007`, `RMP004` in `entrances_ramps.geojson` (all `verified = false`), snapped to the nearest wall. |
| `entrance_4` (standard, steps) | **Invented** | Not in any reference data. Included only to demonstrate a non-accessible entrance. `supported_by_reference = false`. |
| Interior ramp `ramp_1` | **Invented** | Only the *existence* of a ramp near the east side comes from `RMP004`. |
| Rooms, hallways, doors, stairs, elevators, restrooms, fountains | **Invented** | Generator rules. |
| Accessibility flags, narrow hallways, widths, speeds | **Invented** | Clearly labeled synthetic; see `accessibility_assumptions.md`. |
| Obstacles and scenarios | **Invented** | Demonstration data, not student reports. |

### Geometry quality of entrance points
The reference points do not sit exactly on the footprint, so the position uncertainty is real:
`ENT006` is **9.3 m** outside the footprint (west of its north end), `ENT007` is 4.4 m away (east wall), `RMP004` is 2.4 m away (east-wall step).
They were projected to the closest wall point, then moved to a convenient spot along that wall segment.

## Layout approach
- One north-south main corridor (x ~ 11-14 m) with rooms either side, plus a west branch, an east branch (ramp entrance), an east cross corridor and an east link that form a loop (used for the reroute demo).
- Elevators (2), stairwells (2), restrooms (men, women, accessible unisex) and the elevator lobby have identical positions on all floors.
- Floor 1: lobby, reception, classrooms, lecture hall, computer lab, department office, study room. Floor 2: labs, faculty offices, break room, conference room, lecture hall. Floor 3: research labs, offices, conference/study rooms. Floors 2-3 deliberately split some rooms differently.
- Rooms are the intersection of simple rectangles with the footprint inset by 0.25 m, so a few rooms follow the slanted/chamfered outer walls. `x, y, width, height` in `rooms.json` is the bounding box; `polygon` is the true shape.
- Three non-navigable "service" rooms (`room_110`, `room_210`, `room_310`, mechanical) intentionally have no graph nodes (documented exception to "every room has an entrance node").

## Files
Required structure plus a few extras (marked *):
- `buildings/BLD001/`: `floor_1..3.svg`, `rooms.json`, `nodes.json`, `edges.json`, `connections.json`, `obstacles.json`, `metadata.json`, `connectors.json`*, `features.json`*
- `shared/`: `building_index.json`, `indoor_schema.json`, `buildings.json`* (the `buildings.json` from section 8A)
- `documentation/`: the four requested documents plus `integration_guide.md`* and `examples/`* (two SVGs with a route drawn)
- `tools/`*: generator, validator, Python router, TypeScript router.

JSON files are wrapped as `{ schema_version, synthetic, disclaimer, <collection>: [...] }`, not bare arrays.
Rooms.json also contains the 24 hallways (`category: "circulation"`, `navigable: false`) so SVG ids like `hallway_1` have JSON counterparts.

## ID conventions
`room_{floor}{nn}` (e.g. `room_102`), `hallway_1..8` (F1), `9..16` (F2), `17..24` (F3), `door_{room number}`, `door_elev_{k}_f{f}`,
`elevator_1/2` and `stairwell_1/2` (same SVG id on every floor, floor-scoped), `entrance_1..4`, `ramp_1`, `fountain_1..6`,
nodes `n_f{f}_...`, edges `e_f{f}_{nnn}`, connections `conn_{elev|stair}_{k}_f{a}_f{b}`.

## Decisions worth knowing about
1. **Route cost is `travel_time`**, not distance. The normal and alternative routes in the blocked-hallway demo are *equal in distance* (62.0 m); they only differ in time (52.2 s vs 54.0 s) because the east link is modeled as a synthetic narrow corridor (x0.85 speed). If you route by distance you will get a tie.
2. **Obstacles are an overlay.** `edges.json` keeps `obstacle_status = "none"`; `obstacles.json` defines obstacles and `scenarios`. A router applies an obstacle only when `status == "verified"` **and** `verified == true` **and** it belongs to the active scenario.
3. The SVG `layer_obstacles` is static and draws *all* demo obstacles; toggle per scenario in the app (each `g` has `data-status` and an id `obstacle_OBS-xxx`).
4. Elevator outages set `affected_node_ids` (all three floors of that shaft) in addition to the required `location_node_id`.
5. `outdoor_node_id` is `null` for every connector; see `integration_guide.md`.

## Regenerating
```
python3 tools/generate_indoor.py <uploads_dir> <out_dir>
python3 tools/write_schema.py <out_dir>
python3 tools/validate_and_route.py <out_dir>
```
Requires `shapely`, `jsonschema`, `networkx` (and `cairosvg` only if you want PNG previews).
