# Integration Guide - React + TypeScript and your outdoor GeoJSON

> SYNTHETIC / MOCK DATA. Your existing outdoor data (`buildings.geojson`, `sidewalks.geojson`, `entrances_ramps.geojson`) was only **read**, never modified.

## 1. Files to ship with the app
Copy `buildings/BLD001/*` (SVGs + JSON) and `tools/ts/indoorRouting.ts` into your project, e.g. `public/indoor/BLD001/` and `src/indoor/`.

## 2. Load the data (TypeScript)
```ts
import { route, routePointsForFloor, type IndoorData } from "./indoor/indoorRouting";

const base = "/indoor/BLD001/";
const get = async <T,>(f: string) => (await fetch(base + f)).json() as Promise<T>;

export async function loadBuilding(): Promise<IndoorData> {
  const [n, e, c, o, r, f] = await Promise.all([
    get<any>("nodes.json"), get<any>("edges.json"), get<any>("connections.json"),
    get<any>("obstacles.json"), get<any>("rooms.json"), get<any>("features.json"),
  ]);
  return {
    nodes: n.nodes, edges: e.edges, connections: c.connections,
    obstacles: o.obstacles, scenarios: o.scenarios, rooms: r.rooms,
    entrances: Object.fromEntries(f.features.entrances.map((x: any) => [x.feature_id, x.node_id])),
  };
}
```

## 3. Route
```ts
const result = route(data, "entrance_3", "room_212", { wheelchair: true });
if (!result.found) showMessage(result.reason);          // "NO_ACCESSIBLE_ROUTE" | "NO_ROUTE"
else console.log(result.travelTimeS, result.floors, result.links);
```
Endpoints can be room ids (`room_102`), entrance ids (`entrance_1`) or node ids. For obstacle demos pass `scenario: "SCN-BLOCKED-HALLWAY"`.
In production, replace `scenario` with your live list of obstacle ids (`obstacleIds`); the router blocks only `status === "verified" && verified === true`.

## 4. Show a floor and draw the route
```tsx
function Floor({ floor, svgText, data, result }: { floor: 1 | 2 | 3; svgText: string; data: IndoorData; result: RouteResult }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current?.querySelector("#route_layer");
    if (!layer) return;
    const pts = routePointsForFloor(data, result, `BLD001_F${floor}`);
    layer.innerHTML = pts ? `<polyline points="${pts}"/>` : "";
  }, [floor, svgText, data, result]);
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: svgText }} />;
}
```
(`svgText` = `await (await fetch(base + "floor_1.svg")).text()`; the SVG is our own static file, so injecting it is safe here. The component snippet above is illustrative and was not run; the routing module itself was compiled with `tsc --strict` and checked against the Python router, see the validation report.)

Notes for inlining:
- **Render one floor at a time.** Element ids (`elevator_1`, `footprint`, ...) repeat across floors, so inlining several floors at once creates duplicate ids. Alternatively use `<object>`/`<img>` for read-only display.
- The SVG ships its own `<style>` with unprefixed class names (`wall-ext`, `rt-classroom`, ...). Scope or prefix them if they collide with your CSS. Colors are fixed (light background); no dark-mode variant.
- `layer_obstacles` is static (all demo obstacles). Hide/show `#obstacle_OBS-xxx` according to your active obstacle list.
- `layer_nav_graph` is hidden (`display:none`); remove that rule to debug node/edge positions.
- Use `data-room-type`, `data-accessible`, and element ids to attach click handlers; ids match `rooms.json` (`room_id`), `features.json` and `nodes.json` (`svgnode_<node_id>`).
- For multi-floor routes draw one polyline per floor and mark elevator/stair hops from `result.links` (`conn:` entries) in the UI.

## 5. Connecting to your outdoor GeoJSON
The indoor graph exposes four **entrance connector nodes**, listed in `connectors.json`:

| connector | indoor node | outdoor reference (your data) | outdoor_node_id |
|---|---|---|---|
| `conn_out_entrance_1` | `n_f1_entrance_1` | `ENT006`; nearest sidewalk `way/1484121410` (4.4 m from the *raw* point) | `null` |
| `conn_out_entrance_2` | `n_f1_entrance_2` | `ENT007`; `way/225470267` (0.1 m) | `null` |
| `conn_out_entrance_3` | `n_f1_entrance_3` | `RMP004`; `way/335766008` (2.7 m) | `null` |
| `conn_out_entrance_4` | `n_f1_entrance_4` | none (synthetic standard entrance) | `null` |

**Why `outdoor_node_id` is empty.** `sidewalks.geojson` is a set of LineStrings with OSM way ids but no routing-node ids. Without your outdoor graph's node ids, any value would be invented.

**What I need / what to do:**
1. Decide how your app builds its outdoor graph (e.g., sidewalk vertices as nodes).
2. For each connector, pick the outdoor node nearest to the reference point (`ENT006`/`ENT007`/`RMP004`), preferably after checking it on the map; positions are only approximate and `verified` is false.
3. Fill `outdoor_node_id` and set `status` to `"assigned"` in `connectors.json`. Leave `entrance_4` unassigned unless a real entrance is confirmed.
4. Treat the connector as a graph edge (`outdoor_node_id <-> indoor_node_id`) with `accessible` from the connector. A wheelchair route must only cross connectors with `accessible: true`; only the indoor side of `entrance_3` includes a ramp edge.

**Composite routing (recommended):** route outdoors to the connector's outdoor node, then call `route(data, connector.indoor_node_id, "room_xxx", opts)`. Add the outdoor and indoor times. Do not put lat/lon in the indoor graph; keep the two coordinate systems separate and joined only through connectors.

If you later want to draw the floor on the map, use `metadata.json -> georeference_hint` (south-west corner, meters-per-degree factors, no rotation). It is approximate and not needed for routing.

## 6. Replacing synthetic data later
Keep the same file shapes: replace `rooms/nodes/edges/connections` with surveyed data, set `synthetic: false` and `verified: true` where surveyed, and keep `shared/indoor_schema.json` as the contract (`tools/validate_and_route.py` checks both).
