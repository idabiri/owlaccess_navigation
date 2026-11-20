# OwlAccess: accessible campus navigation prototype (KSU Marietta)

OwlAccess is a student hackathon prototype that plans accessible routes across the Kennesaw State University Marietta campus, from an outdoor sidewalk, through a building entrance, along hallways and up elevators, to a room. It also lets people report obstacles, which change routes only after a human reviewer verifies them.

> **Read this first.** This is **not an official Kennesaw State University service** and must not be used for real wayfinding.
> - The **indoor floor plans are synthetic (invented)**. Only the building's outer footprint comes from real (OpenStreetMap) data.
> - Outdoor entrance and ramp locations are **provisional and not field-verified**.
> - Outdoor accessibility (surface, slope, curb cuts) is **unknown**, except that `highway=steps` is excluded in wheelchair mode.
> - The "You are here" marker during navigation is **simulated** from the selected step. The app does not detect anyone's location.

This repository contains the whole project, not just the app: the original GIS data, the synthetic indoor package, the processed and integrated routing data, the scripts that produced them, the audit reports and their raw results, the tests, and the documentation.

---

## Contents

- [Features](#features)
- [Repository structure](#repository-structure)
- [Installation and setup](#installation-and-setup)
- [Running the application](#running-the-application)
- [How the routing works](#how-the-routing-works)
- [How indoor and outdoor data are connected](#how-indoor-and-outdoor-data-are-connected)
- [Running the tests](#running-the-tests)
- [Audit: what was checked, found, fixed and still open](#audit-what-was-checked-found-fixed-and-still-open)
- [Data sources and attribution](#data-sources-and-attribution)
- [Known limitations](#known-limitations)
- Further reading: [DATA_DICTIONARY.md](DATA_DICTIONARY.md), [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md)

---

## Features

- **Start from where you're headed** (`/`). The landing page is the trip form: from, to, and how you get around (walking, step-free or wheelchair). It goes straight to the route options. Places have plain names (for example "Academic Building Entrance", "Engineering Technology Center Entrance"). The survey codes stay in the data.
- **Accessible route planning** (`/plan`). One choice, walking, step-free or wheelchair, sets requirements that are hard rules: a route that breaks them is never offered. Preferences (fastest, shortest, fewest turns, avoid narrow corridors) only rank routes. Demo obstacle scenarios are folded into "Demo options". If no route qualifies, the app says so (`NO_ACCESSIBLE_ROUTE`).
- **Real route alternatives** (`/suggestions`). Every alternative (fastest, shortest, the other elevator or stairwell, avoid narrow corridors, step-free) is computed by the same routing engine. Nothing is invented. Each option shows distance, time, floor changes, turns, elevators or stairs, and warnings. The recommended route leads; each alternative says how it differs (for example "Same time and distance · uses Elevator 2 instead"), caveats shared by every route are shown once, and verified reports are named in words, never by id.
- **Indoor and outdoor in one route.** Outdoor map, then Floors 1 to 3 of the Academic Building (BLD001), switching automatically at the entrance and at elevators.
- **3D (isometric) indoor map** with a 2D plan switch. Built only from the existing floor drawings: walls raised with the drawn door openings, elevators and stairwells as shafts, floors below as slabs. Room numbers and names stay upright and readable at any zoom and never overlap; the route shows done / current step / still to go, floor changes and the simulated position. Zoom, pan, reset and keyboard controls. Walls 3 m high and floors 4 m apart are labelled visual assumptions; routes and coordinates are unchanged.
- **Step-by-step navigation** (`/navigate`). Turn-by-turn steps synced with the map, Previous and Next controls, and a **simulated** position marker. On phones, the map appears only after a route is confirmed, and a step panel sits above the bottom tab bar.
- **Obstacle reporting** (`/report`). Report a blocked hallway, broken elevator, etc. by tapping the floor plan or choosing a place from a list, with full keyboard support. An offline, rule-based helper suggests a category (it is labelled as rules, not AI). Reporting is a guided flow: Where (floor, then the spot), What's wrong, Send.
- **Human review** (`/review`). Reports stay `pending` until a reviewer marks them `verified` or `rejected`, and later `resolved`. **Only verified reports affect routing.** Pending and rejected reports never block a route. The reviewer screen is a queue: counts of waiting, route-changing and closed reports, and one readable card per report.
- **Shared reports on a local network.** During a demo, the laptop's dev server stores reports in one JSON file, and phones on the same Wi-Fi can open `/review`. It answers only private-network addresses.
- **Public static demo (Vercel).** The public build has no server: everyone sees the same preloaded demo obstacles (OBS-001 to OBS-006, shipped with the routing data), while reports and review decisions are saved in each visitor's browser only and are labelled that way. It makes no `/api` calls and does not poll.
- **SOS emergency button.** A red SOS button in the header of every page opens an Emergency help screen with one-tap `tel:` buttons for 911 and KSU Campus Police (470-578-6666). It only opens the phone's dialer: no location is shared, nothing is sent, and the app never claims anyone has been notified.
- **Data transparency** (`/about`). Every number on the site is computed from the loaded data, and each dataset is labelled real, synthetic, provisional or unknown.

---

## Repository structure

```
.
├── README.md                    this file
├── LICENSE                      MIT (code and docs)
├── DATA_DICTIONARY.md           every dataset: format, CRS, fields, status, which feature uses it
├── .gitignore / .gitattributes
├── app/                         React + TypeScript web app (Vite, Vitest)
│   ├── src/                     UI, routing engine (src/routing/), reports (src/reports/)
│   ├── public/data/             runtime copies of the routing data the browser loads (checked against data/)
│   ├── server/                  local dev-server API for shared reports (+ Cloudflare D1 adapter)
│   ├── functions/, migrations/, wrangler.toml   prepared Cloudflare Pages deployment (NOT deployed)
│   ├── scripts/reset-demo.mjs   empties the shared demo reports (keeps a backup)
│   ├── data/                    runtime reports file lives here (git-ignored)
│   └── tests/                   168 automated tests (Vitest + Testing Library, jsdom)
├── data/
│   ├── outdoor/
│   │   ├── source/              ORIGINAL GIS data + QGIS project (read-only; never edited)
│   │   └── processed/           outdoor routing graph, entrance review, Marietta building subset
│   │       └── full_sites/      the same graph before filtering to the Marietta campus
│   ├── indoor/
│   │   ├── BLD001/              SYNTHETIC indoor package: floor SVGs, nodes, edges, rooms, connections, obstacles
│   │   └── shared/              building registry and JSON Schema
│   ├── integrated/              unified indoor + outdoor routing graph and the entrance connectors
│   ├── LICENSE.md               ODbL 1.0 (data)
│   └── reference/
│       ├── georeferencing/      our ground control points for the KSU accessibility map
│       └── ksu_maps/            KSU's published PDF and image maps (git-ignored: see Data sources)
├── audit/
│   ├── phase1/                  project inspection report
│   ├── phase2/                  independent audit of the indoor package: report, raw results, audit scripts
│   ├── indoor_validation/       the indoor package's own 64-check validation report + example route SVGs
│   ├── phase3_4_integration/    entrance review and outdoor graph report (incl. the fixes applied)
│   └── phase8_e2e/              end-to-end routing scenarios and the Python + TypeScript results
├── scripts/
│   ├── indoor/                  synthetic indoor generator, validator, schema writer, original routers
│   ├── integration/             outdoor graph, entrance review, unified graph builders, Python router, parity
│   └── requirements.txt         Python libraries the pipeline scripts need
├── tests/
│   ├── check_data_integrity.py  app data == canonical data; source hashes; manifest
│   └── routing/                 Python end-to-end routing scenarios against data/integrated/
└── docs/
    ├── DATA_PROVENANCE.md       where each dataset came from, processing, licensing
    ├── FILE_MANIFEST.csv        every copied file: original path, size, SHA-256, role
    ├── app/                     demo script, deployment notes (not deployed), design log, design-studio page
    ├── indoor/                  indoor generation notes, coordinate system, accessibility assumptions, guide
    ├── integration/             unified integration guide
    └── brand/                   original logo file
```

**Original vs processed vs synthetic.** `data/outdoor/source/` holds the original files exactly as created (byte-identical, verified by SHA-256). The one exception is `Navigation.qgz`, a sanitized copy with a personal name and a local path removed. Everything in `processed/` and `integrated/` was generated from them by the scripts in `scripts/integration/`. Everything in `data/indoor/` was generated by `scripts/indoor/generate_indoor.py` and is synthetic. See [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

**Why `app/public/data/` duplicates some files.** The browser can only fetch files that the web server publishes, so the app keeps copies of the 7 files it loads. `tests/check_data_integrity.py` confirms these copies are identical to the canonical files in `data/`. The floor SVG copies also carry an embedded C2PA content-credentials block, ignored in that comparison.

---

## Installation and setup

Requirements:

- **Node.js 18 or newer** (developed and tested with Node 26.13.1 and npm 11.20.0)
- **Python 3.10 or newer** for the repository checks (tested with Python 3.14; standard library only)
- Optional, only to re-run the data pipeline: the Python libraries in `scripts/requirements.txt` (numpy, pyproj, shapely, networkx, jsonschema)

```bash
git clone https://github.com/<your-username>/owlaccess_navigation.git
cd owlaccess_navigation/app
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`. No API keys, accounts or paid services are needed.

---

## Running the application

```bash
cd app
npm run dev
```

Open http://localhost:5173. Main pages: `/` landing page, `/plan`, `/suggestions`, `/navigate`, `/report`, `/review`, `/about`.

- **Phone reviewer during a demo:** the dev server also listens on your local network, so a phone on the same Wi-Fi can open `http://<laptop-ip>:5173/review`. Use a trusted network or a phone hotspot. Do not port-forward or tunnel this server: it is a local demo, not a production deployment.
- **Reset the demo reports:** `npm run demo:reset` empties `app/data/obstacle_reports.json` and saves a backup copy next to it first.
- **Production build:** `npm run build` (type-checks, then writes `app/dist/`). `npm run preview` serves the build on port 4173.
- **Public deployment on Vercel** (chosen, not yet deployed): a static Vite site with Root Directory `app`, settings in `app/vercel.json`, no environment variables. See [docs/app/DEPLOY.md](docs/app/DEPLOY.md).
- **Alternative public deployment** (Cloudflare Pages + D1, with a reviewer passcode stored as a Cloudflare secret) is prepared in `functions/`, `migrations/` and `wrangler.toml`, and described in [docs/app/DEPLOY.md](docs/app/DEPLOY.md). **It has not been deployed**; it needs `VITE_SHARED_REPORTS=true` at build time. `wrangler.toml` contains a placeholder database id.

A step-by-step demo script is in [docs/app/DEMO.md](docs/app/DEMO.md).

---

## How the routing works

The router is `app/src/routing/unifiedRouting.ts`. `scripts/integration/unified_routing.py` is a Python reference that must behave identically (`scripts/integration/parity_unified.py` checks this).

1. **Graph.** One undirected graph of 580 nodes and 700 edges (`data/integrated/unified_routing_graph.json`). It contains outdoor path nodes and edges, indoor nodes and edges for each floor, vertical connections (2 elevators and 2 stairwells), and the entrance connector between outdoors and indoors.
2. **Cost.** Dijkstra's shortest path on `travel_time` (seconds). `distance` (metres) is stored separately and can be used as the cost for the "shortest distance" alternative. Ties are broken by node id. Totals are summed in integer hundredths and rounded half-up to tenths, the same in TypeScript and Python. The walking speeds are prototype assumptions, not measurements. The wheelchair time is estimated from the same speeds.
3. **Wheelchair / step-free mode** skips stairs, steps (`highway=steps` outdoors), and any edge or node marked `accessible: false`. If nothing remains, the result is `NO_ACCESSIBLE_ROUTE` instead of a route that breaks the requirement.
4. **Obstacles are an overlay.** An obstacle blocks an edge **only** when `status == "verified"` and `verified == true`, and it is selected (by demo scenario, or because a reviewer verified a user report). Unknown scenario or obstacle ids raise an error (fail closed). User reports with severity `blocks_everyone` block all modes, `blocks_wheelchair` blocks only wheelchair/step-free routes, and `minor` changes nothing.
5. **Alternatives** (`app/src/routing/alternatives.ts`) re-run the same router with different settings: distance cost, excluding the elevator or stairwell the first route used, avoiding potentially narrow corridors, or step-free. Duplicate paths are dropped, and badges are only given when values really differ.
6. **Directions** (`instructions.ts`, `steps.ts`) turn the path into steps such as "Turn left and walk 12 m", "Take elevator 2 from floor 1 to floor 3" and "Enter the Academic Building (provisional entrance, unverified)". Each step carries its warnings.

## How indoor and outdoor data are connected

- **Coordinates.** Outdoor data is in WGS 84 longitude/latitude. Indoor data is in local SVG units (10 units = 1 m, origin top-left, y down) per floor. They never need to share coordinates for routing: the link between them is topological, through a connector edge. For drawing the floor plan on the map, a similarity fit of the 25 footprint vertices to the real OpenStreetMap polygon is used (RMS 0.05 m; see the Phase 3+4 report).
- **Entrances.** The 13 hand-digitized entrance and ramp points (`entrances_ramps.geojson`) were reviewed in `data/outdoor/processed/entrance_review.json`. Each was snapped to its building wall only within strict distance limits, and the original values were kept verbatim. Every row still requires field verification.
- **Connectors** (`data/integrated/indoor_outdoor_connectors.json`). Only **one** is linked: indoor `entrance_2` to outdoor node `oe_ENT007`, status `provisional_unverified`. The rest:
  - `entrance_1` has no outdoor node: its source point (ENT006) is 9.36 m from the wall, too uncertain.
  - `entrance_3` is on hold: the RMP004 attachment is ambiguous between two footways (3.30 m vs 3.32 m).
  - `entrance_4` is a synthetic steps entrance and is never connected.

  So every outdoor-to-indoor route enters through `entrance_2`.
- **Building.** Only BLD001 (H, Academic Building) has an indoor model. The other 66 Marietta buildings are outlines only, and their entrances are not connected.

Details: [docs/integration/integration_guide_unified.md](docs/integration/integration_guide_unified.md).

---

## Running the tests

```bash
# app: 168 tests in 18 files (routing, alternatives, steps, reports, review, shared sync, API, deployment logic, keyboard, phone layout, pages, SOS, public demo, 3D map)
cd app
npm test
npm run build          # type-check + production build

# repository: data integrity and Python end-to-end routing (standard library only), from the repo root
python tests/check_data_integrity.py
python tests/routing/run_e2e.py
```

- The app tests run in **jsdom** (a simulated browser). The project was also checked by hand in a real Chromium browser at desktop and phone sizes. It has **not** been tested with screen readers or on physical phones.
- `run_e2e.py` writes `tests/routing/results/e2e_python_results.json` (git-ignored). It reproduces the archived `audit/phase8_e2e/e2e_python_results.json` exactly.
- The pipeline scripts in `scripts/` were **not re-run** while preparing this repository, because the Python GIS libraries were not installed. Their outputs are the committed files, whose hashes are recorded in `docs/FILE_MANIFEST.csv`.

---

## Audit: what was checked, found, fixed and still open

The full reports and their raw results are in [`audit/`](audit/). This section summarizes them without changing their conclusions.

### What was audited

| Phase | Scope | Report |
|---|---|---|
| 1 | Inspection of the original GIS files and the synthetic indoor package: structure, coordinate systems, readiness for integration | `audit/phase1/phase1_project_report.md` |
| 2 | Independent audit of the indoor package: 98 static checks on SVG/JSON/provenance and documentation claims, a jsdom load test, and **26,474 routes** compared across the Python router, the TypeScript router and an independent networkx implementation | `audit/phase2/` (report, `phase2_static_results.json`, `phase2_routing_results.json`, `browser_dom_results.json`, audit scripts) |
| Indoor validation | The indoor package's own validator (64 checks) | `audit/indoor_validation/validation_report.md` |
| 3 + 4 | Review of all 13 entrance rows; outdoor routing graph built from the sidewalks with 16 independent verification checks | `audit/phase3_4_integration/phase3_4_report.md`, plus `data/outdoor/processed/entrance_review.json`, `outdoor_graph_report.json`, `outdoor_graph_verification.json` |
| 8 | End-to-end routing scenarios (outdoor to indoor, floor changes, elevator outages, verified vs unverified obstacles) in Python and TypeScript | `audit/phase8_e2e/` |

### Problems found

- **F-01 (high):** the TypeScript indoor router *failed open*: an unknown scenario or obstacle id silently applied no obstacles, so a verified blocked hallway could be routed through.
- **F-02 / F-03 / F-11:** Python and TypeScript rounded differently (762 of 26,474 routes differed by 0.1). The claimed parity check was not reproducible, and tie-breaking differed between the two routers.
- **F-04 / F-08:** the integration guide had a code snippet that did not compile, and missing data caveats. A metadata count was ambiguous.
- **F-05:** the indoor generator used an equatorial metres-per-degree value, so the floor-plan footprint is about 0.3% small north-to-south (up to 0.32 m off).
- **F-06:** the delivered floor SVGs carry an embedded C2PA content-credentials block (informational).
- **F-12 and source-data quirks:**
  - one malformed entrance row (`feature_id="ENT"`, `feature_type="008"`, `fid=null`)
  - typos ("Accessiblity", "Design2", "indentified")
  - entrances in EPSG:3857 while other layers are CRS84
  - 29 outdoor `steps` ways and no `wheelchair` tags
  - two entrance rows that cannot be matched to a Marietta building or lie more than 15 m away
- **Outdoor graph:** the sidewalk file covers **two campuses**. On Marietta, the network is split into 5 components with gaps of 9.9 m and 42.8 m.

### What was corrected

- **F-01, F-02, F-03 and F-11 are fixed in the unified routers that the app uses** (`app/src/routing/unifiedRouting.ts` and `scripts/integration/unified_routing.py`):
  - they fail closed on unknown ids
  - totals use integer-hundredths, round-half-up arithmetic
  - ties are broken by node id
  - parity was checked on 2,500 cases with 0 differences
- **F-04 / F-08:** the guide's snippet and data-caveats section were corrected in the post-audit indoor package (see below).
- **F-05:** handled without regenerating the indoor files: the map placement uses a similarity fit instead.
- **Entrance data:** corrections are **proposed only**, in `entrance_review.json`. The source GeoJSON is unchanged (SHA-256 verified by `tests/check_data_integrity.py`).

### What remains unresolved

- **The standalone indoor-package routers in `scripts/indoor/` are the original delivered versions and still contain F-01, F-02 and F-11.** The fixed versions of those two files, the `tools/parity/` harness and the `audit/pre_fix_backup/` folder described in the Phase 3+4 report were produced in the cloud sandbox and are **not in this repository**. The app does not use these routers.
- `scripts/indoor/ts/parity_check.mjs` and the audit scripts in `audit/phase2/` contain the sandbox paths (`/mnt/user-data/...`, `/tmp/...`) they were run with. They are kept unchanged as a record and will not run here without editing.
- The ENT008 correction, the ENT006 and RMP004 positions, the RMP003 ("West Parking Deck") match and the RMP005 position all need checking on site.
- The 9.9 m and 42.8 m outdoor gaps are reported, not joined.
- Only `entrance_2` connects outdoors to indoors. The other two buildings with entrance data have no indoor model.
- The indoor floor-plan scale error (F-05) remains in the indoor files by design.

### Verified vs pending vs synthetic

| Item | Status |
|---|---|
| Building footprints, sidewalks (OpenStreetMap) | Real source data, **not field-verified** by this project |
| Entrance and ramp points (13 rows) | Hand-digitized from KSU's published map; **all `verified=false`**; review statuses: 2 `source_supported`, 9 `corrected_pending_review`, 2 `needs_verification` |
| Indoor-outdoor connector `entrance_2` to `oe_ENT007` | **Provisional, unverified** |
| Everything inside BLD001: rooms, hallways, doors, elevators, stairs, accessibility flags | **Synthetic** |
| Demo obstacles and scenarios (OBS-001 to OBS-006) | **Synthetic**; "verified" means verified *within the demo* |
| User obstacle reports | Pending until a person verifies them; stored only locally (not in this repository) |
| Outdoor surface, slope, curb cuts | **Unknown** |
| Walking and wheelchair speeds | **Assumptions** |
| Position marker during navigation | **Simulated** demo feature |

---

## Data sources and attribution

- **OpenStreetMap.** Building outlines and footpaths: © OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See https://www.openstreetmap.org/copyright. The files derived from them (`ksu_osm.geojson`, `buildings.geojson`, `sidewalks.geojson`, `ksu_buildings.gpkg`, the outdoor and unified graphs, `buildings_marietta.geojson`, and the footprint inside the indoor package) are derivative databases and must keep this attribution. If published, they must be offered under the ODbL.
- **Kennesaw State University.** The published campus accessibility and parking maps were used **as a visual reference** for digitizing entrances and ramps. Those maps are KSU's publications and are **not** included in the public repository (`data/reference/ksu_maps/` is git-ignored). See [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md).
- **Synthetic indoor package.** Generated for this project by `scripts/indoor/generate_indoor.py` (AI-assisted; see the C2PA note in the provenance document).
- **Fonts.** Fraunces and Atkinson Hyperlegible (SIL Open Font License 1.1), installed from npm and bundled at build time.
- KSU's name is used only to describe the campus. This project is not affiliated with or endorsed by Kennesaw State University.

## Licence

- **Code and documentation:** MIT. See [LICENSE](LICENSE).
- **Data** (`data/` and `app/public/data/`): Open Database License (ODbL) 1.0, as required by the OpenStreetMap source. See [data/LICENSE.md](data/LICENSE.md).
- Kennesaw State University's maps are not included and are not covered by either licence.

## Known limitations

- Indoor data is synthetic, and only one building (BLD001) has an indoor model.
- Entrance positions are provisional, and only one indoor-outdoor connection exists.
- Outdoor accessibility beyond steps is unknown. Elevator availability is not live data.
- Walking speeds are assumptions, and wheelchair travel time is an estimate.
- The position marker is simulated. There is no indoor positioning and no GPS.
- Shared reports work only on the local network during a demo. There is no sign-in: reviewers are trusted on the local network, and a passcode is required only in the prepared (not deployed) public version.
- On the public static site, reports and review decisions stay in the visitor's browser: other visitors do not see them.
- Automated tests run in jsdom. Real-browser checks were manual, with no screen-reader or physical-device testing.
- The pipeline scripts were not re-run while preparing this repository (see [Running the tests](#running-the-tests)).
