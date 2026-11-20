# Unified indoor/outdoor navigation – integration guide (KSU Marietta prototype)

**Status: prototype.** Indoor floor plans, nodes and accessibility flags are **SYNTHETIC / MOCK**. Outdoor entrance placement is **provisional and not field-verified**. Outdoor accessibility (surface, slope, curb cuts) is **UNKNOWN** except `highway=steps`. Nothing here is verified for real wayfinding.

## 1. What was produced
| File (in `integration/`) | Purpose |
|---|---|
| `entrance_review.json` | All 13 source entrance rows kept verbatim + findings and proposed corrections (nothing changed in the source). |
| `outdoor_nodes.json`, `outdoor_edges.json` | Marietta-only outdoor graph from `sidewalks.geojson` (361 nodes, 472 edges). Full two-site versions are in `full_sites/`. |
| `indoor_outdoor_connectors.json` | Explicit connectors between indoor entrances and outdoor nodes, each with a verification status. |
| `unified_routing_graph.json` | Indoor + outdoor + connectors in one graph (580 nodes, 700 edges), with obstacles, scenarios and an `endpoints` map. |
| `buildings_marietta.geojson` | Marietta-only building polygons for the map (derived copy; original untouched). |
| `tools/unified_routing.py` | Python router. |
| `e2e/` | Scenarios, Python runner, Python + TypeScript results, `e2e_test_results.md`. |
| `app/` | React + TypeScript app (Vite, vitest). Router: `src/routing/unifiedRouting.ts`. |

## 2. Source data rules followed
Original GeoJSON files and the indoor floor plans / JSON are unchanged (SHA-256 of the three GeoJSON files match `entrance_review.json`). Derived files carry their own names. Corrections to GIS records are only *proposed* in `entrance_review.json`.

## 3. Connector policy (current state)
- `entrance_2` ↔ `oe_ENT007`: connected, **provisional_unverified**.
- `entrance_3`: held – attachment to RMP004 ambiguous (3.30 m vs 3.32 m).
- `entrance_1`: no outdoor node (ENT006 is 9.36 m off).
- `entrance_4` (steps): never connected.
- `oe_ENT008` exists but is provisional: the source row needed a proposed correction (`feature_id`, `feature_type`, `fid=13`) that is **not applied** to the source.
- Thresholds: entrance point ≤5 m from footprint; footway ≤10 m from wall point; link must not cross a building. Gaps of 9.9 m and 42.8 m between outdoor components were left open (reported, not joined).
- Because only one building connector exists, outdoors→indoors routes enter through `entrance_2`.

## 4. Routing behaviour (Python = TypeScript)
Dijkstra on travel time (distance kept as a separate attribute); ties broken by node id; totals in integer hundredths, rounded half-up to tenths. Walking: outdoor + hallways, stairs and elevators allowed. Wheelchair: no stairs, no `accessible:false` edges/nodes; failure reason `NO_ACCESSIBLE_ROUTE`. Obstacles apply only when `status == "verified" && verified == true` and selected via scenario/ids; unknown ids throw. Outdoor speeds (1.3 m/s, 0.5 m/s on steps) are assumptions. Parity: `python3 integration/tools/parity_unified.py` (2,500 cases, 0 differences; needs node + tsc on PATH).

## 5. Running the app
```
cd app && npm install
npm run dev        # http://localhost:5173
npm test           # 20 vitest tests (11 routing, 9 component)
npm run build
```
Data is fetched from `public/data/` (copies of the integration files plus `floor_1..3.svg`). To refresh after regenerating data, re-copy those 7 files. The app shows a permanent banner that the data is synthetic/provisional.

UI: outdoor map, indoor floors 1–3 (tabs), start/destination selects or click-to-pick (map or room), walking/wheelchair, avoid stairs, avoid verified obstacles, demo scenario, results with distance/time/turn-by-turn/floor transitions/accessibility limitations. The view follows the active route segment (outdoor → floor at the entrance → next floor at an elevator/stair); Previous/Next steps through segments.

## 6. Adding another building later
1. Add its indoor package (nodes, edges, SVG per floor) with its own `building_id`.
2. Add its footprint to the buildings file and confirm entrances in `entrance_review.json`.
3. Extend `tools/build_unified.py` with a connector entry (status `provisional_unverified` until field-checked) and re-run it.
4. Add the SVGs to `public/data/` and `AppData.svgs` (currently keyed by floor number for BLD001; key by building+floor when a second building is added).

## 7. Known limitations / open decisions
- Needs real-world confirmation: ENT008 correction, ENT006 and RMP004 entrance positions, whether to loosen thresholds or join the 9.9 m gap.
- Indoor plan is placed on the map by a similarity fit (scale 1.0029, RMS 0.05 m); the generator's N-S metre constant is ~0.3% low. Not regenerated.
- Marietta components other than the main one (C02) are mostly unreachable from the building.
- Tested in jsdom only; not tested in a real browser, on touch devices, or with screen readers.
