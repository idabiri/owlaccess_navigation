# Accessibility Assumptions

> SYNTHETIC / MOCK DATA. **None of the accessibility attributes below have been field-verified.** Every record has `synthetic: true` and `verified: false`.

## What the reference data says
- `entrances_ramps.geojson` marks three features near the Academic building (`ENT006`, `ENT007`, `RMP004`) as `accessible: true`, `verified: false`. Those flags are carried over to `entrance_1`, `entrance_2`, `entrance_3` as *unverified*.
- Nothing in the reference data describes interiors: no hallway widths, door widths, elevators, ramp slopes or restrooms.

## Invented attributes
| Feature | Assumption |
|---|---|
| Elevators 1-2 | Accessible, serve floors 1-3, identical position per floor. Elevator connection: 25 s (wait + ride), 4.5 m vertical. |
| Stairwells 1-2 | Stairs only. `accessible: false`, `stairs_only: true`. Stair connection: 14 s, 6.0 m. The stairwell door/landing edges are also inaccessible. |
| `entrance_4` | Standard entrance with exterior steps (`edge_type: entrance_steps`, `stairs_only: true`, `accessible: false`). **Invented**. |
| `ramp_1` | Interior ramp by `entrance_3`; accessible edge of type `ramp`. Slope and length are not modeled. |
| Narrow hallways | `hallway_2` (west branch) and `hallway_8` (east link) carry `potentially_narrow: true` and a **synthetic** width of 2.0 m (others 3.0 m). They remain `accessible: true` because an *unverified* concern must not block routes. Narrow edges are routed 15% slower. |
| Doors | All doors/openings are drawn 1.2 m wide (3.0 m for lobby openings) purely for drawing; these are not measurements (`opening_width_synthetic_m`). |
| Restrooms | Men/Women restrooms assumed to contain an accessible stall (unverified). `room_x08` is a designated single-user accessible restroom. |
| Walking speed | 1.2 m/s on level ground, 0.8 on ramps, 0.4 on exterior steps, 1.0 on doors. No separate wheelchair speed. |
| Water fountains | Two per floor, `accessible: true`, features only (not graph nodes). |

## Routing rules implemented (`tools/indoor_routing.py`, `tools/ts/indoorRouting.ts`)
1. Wheelchair mode excludes edges/connections with `accessible == false` or `stairs_only == true`, and nodes with `accessible == false`.
2. Wheelchair mode may use accessible elevators (`connection_type: elevator`) and ramp edges.
3. A **verified** obstacle (`status == "verified"` and `verified == true`) in the active scenario blocks its edge/node(s) for **all** users.
4. `pending`, `resolved`, or unverified obstacles never block.
5. No path -> `{ found: false, reason: "NO_ACCESSIBLE_ROUTE" }` in wheelchair mode, `"NO_ROUTE"` otherwise.

## Demonstration obstacles
| ID | Type | Status | Scenario(s) | Effect |
|---|---|---|---|---|
| OBS-001 | blocked hallway (F1 main corridor, elevator-lobby segment) | verified | SCN-BLOCKED-HALLWAY | room_102 -> room_117 detours via east branch + east link |
| OBS-002 | elevator 1 unavailable | verified | SCN-ELEVATOR-1-OUT, SCN-NO-ELEVATOR | elevator 2 used instead |
| OBS-003 | elevator 2 unavailable | verified | SCN-NO-ELEVATOR | with OBS-002: no accessible route to floors 2-3 |
| OBS-004 | blocked doorway (room_103) | **pending** | SCN-UNVERIFIED-ONLY | must not block |
| OBS-005 | construction area (F1 lobby) | verified | SCN-CONSTRUCTION | room_119 unreachable for everyone |
| OBS-006 | blocked hallway (F2) | **resolved** | SCN-RESOLVED-IGNORED | must not block |

All descriptions are prefixed "SYNTHETIC DEMO DATA".

## Not modeled
Door hardware, thresholds, turning radii, slope, surface, signage, tactile paving, automatic openers, emergency egress, and real elevator capacity. Add them as verified attributes once surveyed.
