# Data dictionary

Status keys:
- **Original**: created by the project team or exported from a source, kept byte-identical.
- **Processed**: generated from original data by a script in `scripts/`.
- **Synthetic**: invented demonstration data.
- **Runtime**: created while the app runs; not in the repository.

CRS: `CRS84` and `EPSG:4326` are WGS 84 longitude/latitude (CRS84 lists longitude first). `EPSG:3857` is Web Mercator, in metres. "Local SVG units" means 10 units = 1 m, origin top-left, x east, y down, one frame per floor.

App features named below: **Plan** (`/plan`), **Options** (`/suggestions`), **Navigate** (`/navigate`), **Report/Review** (`/report`, `/review`), **About** (`/about`), **Map** (the outdoor map drawn on every map page).

---

## 1. Outdoor: original source (`data/outdoor/source/`)

### `ksu_osm.geojson`
| | |
|---|---|
| Format / CRS | GeoJSON (no `crs` member, so RFC 7946 WGS 84) |
| Represents | OpenStreetMap export around the KSU campuses: 929 features (points, lines, polygons) |
| Fields | OpenStreetMap tags as properties (`@id` = OSM object, `building`, `highway`, `footway`, `surface`, `incline`, `name`, ...) |
| Status | Original (OpenStreetMap, ODbL) |
| Used by | Source for `buildings.geojson` and `sidewalks.geojson`; QGIS project. Not loaded by the app. |

### `buildings.geojson`
| | |
|---|---|
| Format / CRS | GeoJSON, CRS84 |
| Represents | 167 building polygons from OpenStreetMap, covering more than the Marietta campus |
| Fields | OSM tags (`@id`, `name`, `building`, `building:levels`, ...), plus fields added by the team: `building_id` (`BLD001` Academic, `BLD002` Design 2, `BLD003` Engineering Technology Center; null for the others), `building_name`, `building_code`, `indoor_mapping` |
| Status | Original (OSM-derived, attributes added in QGIS) |
| Used by | Outdoor graph builder (to keep entrance links from crossing buildings), entrance review, indoor generator (BLD001 footprint), `buildings_marietta.geojson` |

### `sidewalks.geojson`
| | |
|---|---|
| Format / CRS | GeoJSON, CRS84 |
| Represents | 700 walkable lines from OpenStreetMap: 671 `highway=footway` and 29 `highway=steps`. It covers two campuses. |
| Fields | OSM tags: `@id` (`way/<id>`), `highway`, `footway` (sidewalk / crossing / traffic_island), `surface`, `incline` (up/down only), `ramp`, `step_count`, `tactile_paving`, `bridge`, `tunnel`, `layer`. **No `wheelchair` tag anywhere.** |
| Status | Original (OSM-derived) |
| Used by | Outdoor routing graph |

### `entrances_ramps.geojson`
| | |
|---|---|
| Format / CRS | GeoJSON, **EPSG:3857** (different from the other layers) |
| Represents | 13 building entrance and ramp points, digitized by hand in QGIS from KSU's published accessibility map |
| Fields | `fid`, `feature_id` (ENT001 to ENT007, RMP001 to RMP005), `feature_type` (entrance / ramp), `building_name`, `accessible` (as shown on the map), `verified` (**false for every row**), `source` ("KSU Accessibility Map"), `notes` |
| Known issues | One malformed row (`feature_id="ENT"`, `feature_type="008"`, `fid=null`; proposed correction ENT008, not applied); typos "Accessiblity", "Design2", "indentified" |
| Status | Original (team-digitized, unverified) |
| Used by | Entrance review, outdoor entrance nodes, indoor entrance placement |

### `accessibility_data/ksu_accessibility.gpkg`, `accessibility_data/ksu_buildings.gpkg`
| | |
|---|---|
| Format / CRS | GeoPackage, EPSG:3857 |
| Represents | QGIS working layers: `ksu_accessibility` (12 entrance and ramp points, same fields as above; the malformed 13th row exists only in the GeoJSON) and `buildings` (the 167 building polygons with the added `building_id`, `building_name`, `building_code`, `indoor_mapping` fields) |
| Status | Original (editing layers behind the GeoJSON exports) |
| Used by | QGIS project only |

### `Navigation.qgz`, `*.qmd`
QGIS project (layers referenced by **relative paths**, so keep this folder's layout) and QGIS layer metadata. The committed `Navigation.qgz` is a **sanitized copy**: the QGIS save-user name, the project author and one absolute local path were removed. Layers, styles and settings are unchanged. The project also references `./maps/KSU Marietta Campus_Accessibility Map_modified.tif` (git-ignored, see `data/reference/`) and the OpenStreetMap tile service. Original. Not used by the app.

---

## 2. Outdoor: processed (`data/outdoor/processed/`)

### `outdoor_nodes.json`, `outdoor_edges.json`
| | |
|---|---|
| Format / CRS | JSON, EPSG:4326 lon/lat |
| Represents | Marietta-only outdoor routing graph: 361 nodes, 472 edges (components within 2 km of BLD001) |
| Node fields | `node_id` (`on_` + hash of the coordinates, stable; `oe_<feature>` for entrance attachment nodes), `lon`, `lat`, `node_type`, `degree`, `component_id`, `on_marietta_campus`, `derived`, `source` |
| Edge fields | `edge_id`, `from_node`, `to_node`, `edge_type` (footway / steps / entrance link), `geometry` (lon/lat list), `distance` (m, geodesic), `travel_time` (s; 1.3 m/s footway, 0.5 m/s steps: **assumptions**), `accessible` (false only for steps), `accessibility_basis`, `stairs_only`, `osm_way`, `attributes` (OSM tags carried through, not interpreted), `verified` (false), `obstacle_status`, `component_id` |
| Status | Processed (`build_outdoor_graph.py`, then `filter_marietta.py`) |
| Used by | Unified graph; `outdoor_edges.json` is also drawn by the app's Map (copy in `app/public/data/`) |

### `full_sites/outdoor_nodes.json`, `full_sites/outdoor_edges.json`
The same graph before filtering: 1,062 nodes, 1,319 edges, 33,120 m, two campuses. Processed. Kept for traceability; not used by the app.

### `outdoor_graph_report.json`, `outdoor_graph_verification.json` (also in `full_sites/`)
| | |
|---|---|
| Represents | Report: components, entrance attachment decisions with reasons, candidate gaps (reported, not joined), crossings without shared vertices, thresholds. Verification: 16 independent checks (all pass). |
| Status | Processed (audit evidence). The two copies of the report are identical: it was computed on the full graph before filtering. |

### `entrance_review.json`
| | |
|---|---|
| Represents | Review of all 13 source entrance rows plus the synthetic `entrance_4`. Original values are copied verbatim; corrections are only proposed. |
| Fields | `source_sha256` (hashes of the 3 source GeoJSON files), `thresholds`, `status_definitions`, `indoor_to_campus_fit` (similarity fit: scale, rotation, residuals), `status_counts`; per entrance: `feature_id`, `feature_type`, `original_coordinates`, `building_id`, `distance_original_to_boundary_m`, `proposed_snap`, `review_status` (`source_supported` / `corrected_pending_review` / `needs_verification` / `synthetic_demo`), `issues`, `requires_field_verification` (true for all) |
| Status | Processed |
| Used by | Outdoor graph builder, unified graph builder, `tests/check_data_integrity.py` (source hashes) |

### `buildings_marietta.geojson`
| | |
|---|---|
| Format / CRS | GeoJSON, WGS 84 |
| Represents | 67 Marietta building polygons (within 1.5 km of BLD001) |
| Fields | `id` (OSM way), `name`, `building`, `building_id`, `indoor_mapping` |
| Status | Processed (`build_unified.py`) |
| Used by | Map (outlines, building selector, report counts), About page counts |

---

## 3. Indoor: synthetic package (`data/indoor/`)

Every JSON file is wrapped as `{ schema_version, building_id, synthetic: true, disclaimer, coordinate_system, <collection>: [...] }` and validates against `shared/indoor_schema.json`. **Everything except the outer footprint is synthetic.** Coordinates are local SVG units.

| File | Records | Important fields | Used by |
|---|---|---|---|
| `BLD001/floor_1.svg` to `floor_3.svg` | 3 floor plans, `viewBox 0 0 680 1120` | element ids match the JSON (`room_*`, `door_*`, `entrance_*`, `elevator_1/2`, `stairwell_1/2`); empty `route_layer` group; hidden `layer_nav_graph` | Navigate, Report (copies in `app/public/data/`) |
| `BLD001/rooms.json` | 85 = 58 navigable rooms + 3 service rooms + 24 hallways | `room_id`, `room_number`, `room_name`, `room_type`, `category`, `floor_id`, `polygon`, `x/y/width/height`, `navigable`, `accessible`, `entrance_node_id`, `destination_node_id` | Unified graph (room endpoints and labels) |
| `BLD001/nodes.json` | 219 (73 per floor) | `node_id` (`n_f<floor>_...`), `node_type` (hallway, intersection, room_entrance, destination, elevator, staircase, entrance, ramp, restroom), `x`, `y`, `floor_id`, `room_id`, `accessible`, `verified` (false) | Unified graph |
| `BLD001/edges.json` | 219 | `from_node`, `to_node`, `edge_type`, `distance` (m), `travel_time` (s; 1.2 m/s hallway, 1.0 door, 0.8 ramp, 0.4 steps, ×0.85 when narrow), `accessible`, `stairs_only`, `potentially_narrow`, `space_id`, `obstacle_status` (always `none`: obstacles are an overlay) | Unified graph |
| `BLD001/connections.json` | 8 (2 elevators and 2 stairwells × 2 floor hops) | `from_floor`, `to_floor`, `from_node`, `to_node`, `connection_type`, `accessible` (stairs false), `stairs_only`, `travel_time` (elevator 25 s, stairs 14 s) | Unified graph (vertical edges) |
| `BLD001/obstacles.json` | 6 obstacles, 7 scenarios | `obstacle_id`, `obstacle_type`, `affected_edge_id`, `floor_id`, `status` (verified / pending / resolved), `verified`, `scenario_ids`; scenarios: `scenario_id`, `obstacle_ids`, `description`; `rule` (block only if verified) | Demo scenario selector |
| `BLD001/connectors.json` | 4 | indoor side of the entrances; `outdoor_node_id` is null on purpose; `nearest_sidewalk_way_hint` | Superseded by `data/integrated/indoor_outdoor_connectors.json` |
| `BLD001/features.json` | 4 entrances, 2 elevators, 2 stairwells, 1 ramp, 64 doors, 6 fountains | feature ids matching the SVG, `node_id` | Unified graph (entrance endpoints) |
| `BLD001/metadata.json` | 1 | floors, counts (`rooms` = 58 navigable rooms only), SVG units, `georeference_hint` (approximate; see audit F-05), source | Documentation |
| `shared/buildings.json`, `building_index.json` | 1 building; index of 3 | registry; BLD002 and BLD003 listed as not generated | Documentation |
| `shared/indoor_schema.json` | JSON Schema draft-07 | definitions for every file above | Validator |

---

## 4. Integrated (`data/integrated/`)

### `unified_routing_graph.json`
| | |
|---|---|
| Format | JSON (compact). Outdoor nodes in lon/lat, indoor nodes in local SVG units per floor |
| Represents | One graph for routing: 580 nodes, 700 edges, 6 obstacles, 7 scenarios |
| Node fields | `node_id`, `domain` (`outdoor` / `indoor`), `node_type`, `x`, `y` (lon/lat outdoors), `floor_id`, `building_id`, `room_id`, `accessible`, `synthetic` |
| Edge fields | `edge_id`, `from_node`, `to_node`, `domain`, `edge_type` (incl. `elevator`, `staircase`, `building_connector`, `steps`, `ramp`), `distance`, `travel_time`, `accessible`, `stairs_only`, `vertical`, `potentially_narrow`, `provisional`, `verified`, `synthetic`, `floor_id`, `space_id` |
| Other | `endpoints` (selectable place id to node id), `endpoints_meta` (labels), `obstacles`, `scenarios`, `obstacle_rule`, `cost`, `generated_from` (SHA-256 of the 3 source GeoJSON files), `disclaimer` |
| Status | Processed (`build_unified.py`) from outdoor processed data plus synthetic indoor data |
| Used by | **All routing**: Plan, Options, Navigate, Report (snapping reports to edges), About (copy in `app/public/data/`) |

### `indoor_outdoor_connectors.json`
| | |
|---|---|
| Represents | 4 connectors between indoor entrances and outdoor nodes |
| Fields | `connector_id`, `indoor_feature_id`, `indoor_node_id`, `outdoor_node_id` (null unless linked), `status`, `verification_status` (`provisional_unverified`), `entrance_review_status`, `reason`, `distance`, `travel_time`, `accessible`, `source_feature_id`, `verified` (false) |
| Status | Processed. Only `entrance_2` is linked. |
| Used by | Unified graph; About page (entrance counts) |

---

## 5. Reference (`data/reference/`)

| File | Status | Notes |
|---|---|---|
| `georeferencing/KSU Marietta Campus_Accessibility Map.jpg.points` | Original (team) | QGIS ground control points for georeferencing the KSU map image, in EPSG:3857 |
| `georeferencing/*.aux.xml` | Original (QGIS) | GDAL sidecar files written by QGIS for the map image and the georeferenced TIF |
| `ksu_maps/` (PDF, JPG, TIF) | Third party, **git-ignored** | KSU accessibility and parking maps (Marietta and Kennesaw), the source image and its georeferenced `_modified.tif`. Used only as a visual reference. |

---

## 6. App runtime data

### `app/public/data/*`
Copies of the files the browser loads: `unified_routing_graph.json`, `outdoor_edges.json`, `buildings_marietta.geojson`, `indoor_outdoor_connectors.json` and `floor_1..3.svg`. The SVG copies carry an embedded C2PA block. `tests/check_data_integrity.py` confirms they match `data/`.

### `app/data/obstacle_reports.json` (runtime, git-ignored)
Created by the dev server when the first report is saved.
- File fields: `schema`, `version`, `revision` (incremented on every change), `updated_at`, `reports`.
- Report fields: `report_id`, `category`, `description` (free text typed by the reporter), `location_label`, `floor_id`, `x`, `y`, `affected_edge_id`, `snap_distance_m`, `severity` (`blocks_everyone` / `blocks_wheelchair` / `minor`), `status` (`pending` / `verified` / `rejected` / `resolved`), `verified`, `suggestion` and `suggestion_accepted` (from the rule-based classifier), `review` (decision, reviewer label, time, note), `created_at`, `source`.

It is excluded from the repository because it holds whatever demo users typed. `app/data/obstacle_reports.backup-*.json` files are created by `npm run demo:reset`.

### `app/src/design/design.json`
UI design tokens (colours, radius, layout options) edited through the design studio. Original.

### `app/tests/fixtures/scenarios.json`, `e2e_python_results.json`
Test fixtures: copies of the Phase 8 scenarios and the Python results that the TypeScript tests compare against.
