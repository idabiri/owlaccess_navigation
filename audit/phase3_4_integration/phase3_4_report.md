# Phase 3 + 4 Report - Entrance Review and Outdoor Routing Graph

> Source GeoJSON files were only read (SHA-256 unchanged). Interior data remains **SYNTHETIC / MOCK**. Nothing here is field-verified. No indoor/outdoor connector has been created yet (that is Phase 5, waiting for your review).

## Pre-work: approved package fixes (done)

| Finding | Change | Evidence |
|---|---|---|
| F-01 TS fail-open | both routers throw on unknown scenario/obstacle ids | parity harness checks it in both |
| F-02 rounding | integer hundredths, round half-up, in both | 0 differences in 26,474 routes |
| F-03 parity not shipped | `tools/parity/run_parity.sh` (+exporter, comparer); old `parity_check.mjs` removed | runs both `travel_time` and `distance` costs: 0 differences |
| F-11 tie-break | (cost, node id) order in both; TS gained a `cost` option | covered by the same run |
| F-04/F-08 guide | snippet imports fixed (compiles under `tsc --strict`), data-caveats section, count note | guide section 7 |
| F-05 footprint scale | indoor files **not** regenerated; similarity fit used instead (below) | fit RMS 0.05 m |

Originals of every edited file are in `audit/pre_fix_backup/`. All 8 indoor JSON data files are byte-identical to the delivered package; the package validator still reports 64/64.

## Phase 3 - Entrance review (`entrance_review.json`)

All 13 source rows were reviewed; original properties and coordinates are copied verbatim, proposed snaps are stored separately. Review thresholds (mine, adjustable): snap <= 3 m -> `source_supported`; 3-15 m -> `corrected_pending_review`; beyond that or no building match -> `needs_verification` (no snap). **Every row still has `requires_field_verification: true`; a nearby wall point is not treated as verification.**

| Row | Type | Building | Original -> wall (m) | Status | Notes |
|---|---|---|---|---|---|
| ENT001 | entrance | BLD003 | 2.69 | `source_supported` |  |
| ENT002 | entrance | BLD002 | 7.53 | `corrected_pending_review` | source_typo: 'Accessiblity' |
| ENT003 | entrance | BLD002 | 3.77 | `corrected_pending_review` | name_typo: 'Design2' (matched to 'Design 2' / I2 - Design 2 Building) |
| ENT004 | entrance | BLD002 | 6.38 | `corrected_pending_review` |  |
| ENT005 | entrance | BLD003 | 8.7 | `corrected_pending_review` |  |
| ENT006 | entrance | BLD001 | 9.36 | `corrected_pending_review` |  |
| ENT007 | entrance | BLD001 | 4.43 | `corrected_pending_review` |  |
| RMP001 | ramp | BLD003 | 8.35 | `corrected_pending_review` |  |
| RMP002 | ramp | BLD002 | 6.43 | `corrected_pending_review` |  |
| RMP003 | ramp | West Parking Deck | n/a | `needs_verification` | the polygon matched by name is 12.5 km away: most likely a same-named building on another campus, so the Marietta building is NOT identified; no snap  |
| RMP004 | ramp | BLD001 | 2.36 | `source_supported` |  |
| RMP005 | ramp | Science Lab Annex | 21.12 | `needs_verification` | original point is 21.1 m from the footprint (> 15.0 m): no snap proposed |
| ENT | 008 | BLD003 | 0.04 | `corrected_pending_review` | shifted_row: feature_id='ENT', feature_type='008', fid=null |
| entrance_4 (indoor) | - | BLD001 | - | `synthetic_demo` | invented demo; never a real connection |

- **Counts:** {'source_supported': 2, 'corrected_pending_review': 9, 'needs_verification': 2, 'synthetic_demo': 1}.
- **ENT008:** the row `feature_id='ENT', feature_type='008', fid=null` sits only 0.04 m from the Engineering Technology Center wall. Proposed correction: `feature_id='ENT008', feature_type='entrance', fid=13` (medium confidence; evidence in the file). **Source not edited**; confirm with whoever maintains the QGIS layer.
- **RMP003 ('West Parking Deck'):** the only polygon with that name is 12.5 km away (another campus), so the Marietta deck is not identified; no snap.
- **BLD001 entrances vs the synthetic indoor entrances:** ENT007 -> entrance_2 differs by 0.12 m, ENT006 -> entrance_1 by 1.67 m, RMP004 -> entrance_3 by 1.75 m. Indoor positions are synthetic placements along the wall, not surveyed doors.
- **Indoor-to-map placement:** a similarity fit of the 25 footprint vertices to the raw polygon (scale 1.00286, rotation 0.007 deg, RMS residual 0.052 m, max 0.074 m) is the recommended way to place the floor plan on the map. It also confirms audit finding F-05: the generator's N-S scale is about 0.29% low.

## Phase 4 - Outdoor routing graph

**What the data contains:** 700 LineStrings (671 `footway`, 29 `steps`), no other highway types, no `wheelchair` tag, 7 `incline` tags (up/down only, no values). Buildings: 167 polygons (only 3 carry a `building_id`). Entrances: 13 point rows (3857).

**Graph built** (`outdoor_nodes.json`, `outdoor_edges.json`): 1062 nodes, 1319 edges, 33,120 m of path. Nodes are created only at shared vertices (junctions), way endpoints, and provisional entrance attachment points; ids are stable hashes of the coordinates. **No proximity joins were made.** Edges carry geometry, `distance` (m, geodesic) and `travel_time` (s) separately.

**Accessibility attributes:** only `highway=steps` can be excluded for wheelchairs (29 edges). Every other footway is `accessible: true` with the basis *'no exclusion tag; accessibility UNKNOWN'*; surface, incline, ramp, tunnel, bridge, crossing tags are carried as attributes but not interpreted.

**Is it connected enough to route?**

- The file covers **more than one site**: components C01, C03, C05, C07 and others lie about 11.9 km from the Marietta campus (probably the main Kennesaw campus; I did not verify). My earlier figure of '26 components' in the Phase 1 report mixed both sites.
- **Marietta (within 2 km): 5 components, 14,188 m.** C02 holds 86% of the length and contains all three outdoor entrance nodes (oe_ENT007, oe_RMP004, oe_ENT008). The other four (C04 1,455 m, C06 501 m, C08 33 m, C11 33 m) are separate islands.
- Closest approach C02 <-> C06 is 9.9 m and C02 <-> C04 is 42.8 m: **reported only, not joined** (see `outdoor_graph_report.json`). Joining them is a decision for you, ideally after checking a map.
- Wheelchair mode (steps removed) splits the network further: 39 components, largest 540 nodes (all sites).
- 32 endpoints lie within 3 m of another way without a shared vertex (2 would join components, both in the far site). All reported, none joined. 3 crossings without a shared vertex are all bridge/layer separations and stay unjoined. 22 ways pass through building polygons (covered passages or data noise), informational.

**Outdoor entrance nodes:** created only when the original source point is <= 5 m from its footprint, the nearest non-steps footway is <= 10 m from the wall point, and the straight link crosses no building polygon.

| Row | Outdoor node | Attached way | Link (m) | Reason if none |
|---|---|---|---|---|
| ENT001 | - | - | - | nearest walkable footway is 20.5 m from the wall point (> 10.0 m) |
| ENT002 | - | - | - | original source point is 7.53 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| ENT003 | - | - | - | link would cross building(s): ['unnamed [way/589314482]'] |
| ENT004 | - | - | - | original source point is 6.38 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| ENT005 | - | - | - | original source point is 8.7 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| ENT006 | - | - | - | original source point is 9.36 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| ENT007 | oe_ENT007 | way/225470267 | 4.5 |  |
| RMP001 | - | - | - | original source point is 8.35 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| RMP002 | - | - | - | original source point is 6.43 m from the footprint (> 5.0 m): too uncertain for an outdoor node |
| RMP003 | - | - | - | no proposed snap (needs_verification) |
| RMP004 | oe_RMP004 | way/1134398595 | 3.32 |  (AMBIGUOUS: [[3.3, 'way/335766008']]) |
| RMP005 | - | - | - | no proposed snap (needs_verification) |
| ENT | oe_ENT008 | way/225485333 | 0.05 |  |

Only **3 of 12** usable rows qualify, deliberately: with the thresholds above, ENT001-ENT006, RMP001, RMP002 have no outdoor node. RMP004's attachment is ambiguous (two footways 3.30 m and 3.32 m away) and must be reviewed before it is used as a connector. ENT008's identity is still pending review.

**Independent verification (16 checks):** 16/16 pass, including length conservation (33,120 m source = 33,120 m graph), component count equal to the raw shared-vertex count, steps excluded in wheelchair mode, and no entrance node for `entrance_4` or any `needs_verification` row.

## Preview of Phase 5 under the current rules (nothing written yet)

| Indoor entrance | Source | Would the connector be assigned? |
|---|---|---|
| entrance_1 | ENT006 (9.36 m off) | **No** - unassigned, outdoor id null |
| entrance_2 | ENT007 (4.43 m, on a footway, 0.1 m) | **Yes, provisional** -> `oe_ENT007` (unverified) |
| entrance_3 | RMP004 (2.36 m) | **Hold** - ambiguous attachment between two footways; needs your review |
| entrance_4 | none | **No** - synthetic_demo, never connected |

## Decisions needed before Phase 5

1. Are the thresholds acceptable (snap <= 5 m for an outdoor node, link <= 10 m), or should I loosen them (more entrances connected, more uncertainty)?
2. Do you want the 9.9 m (C02-C06) and 42.8 m (C02-C04) gaps left open, or reviewed and joined by documented connector edges?
3. Should ENT008 be provisionally treated as ENT008 in the graph (as now, flagged pending), or excluded until you confirm the row?
4. The far-site components: keep in the files (flagged `on_marietta_campus: false`) or filter out of the Marietta app data?

## Files

`entrance_review.json`, `outdoor_nodes.json`, `outdoor_edges.json`, `outdoor_graph_report.json`, `outdoor_graph_verification.json`, and `tools/` (`build_entrance_review.py`, `build_outdoor_graph.py`, `verify_outdoor_graph.py`; run with `python3 -I` against the uploads folder).