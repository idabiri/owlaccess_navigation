# Coordinate System

> SYNTHETIC / MOCK DATA - local indoor coordinates only; no latitude/longitude appears in the indoor graph.

## Local frame (one per building)
- **Units:** SVG user units. **10 units = 1 meter** (synthetic scale chosen for the prototype).
- **Origin:** top-left of the SVG `viewBox` (`0 0 680 1120`). **x** increases to the right (east), **y** increases downward (south).
- **North:** up. The footprint is not rotated.
- All rooms, nodes, doors, walls, edges and obstacles on every floor of BLD001 use this single frame; every floor shares the same `viewBox`.

## Relation to the footprint's local meters
The generator works in meters with y pointing north, measured from the footprint's south-west bounding-box corner (call it `(xm, ym)`):

```
svg_x = 150 + 10 * xm
svg_y = 110 + 10 * (90 - ym)          // 90 m is the height used to flip y
xm    = (svg_x - 150) / 10
ym    = 90 - (svg_y - 110) / 10
```
The 150 / 110 offsets leave room for title, legend, north arrow and entrance symbols.

## Distances
`edges.distance` is in **meters**, computed from the node coordinates in the file (`hypot(dx, dy) / 10`). The validator re-checks this for every edge.

## Optional georeference hint (not used for routing)
`buildings/BLD001/metadata.json -> georeference_hint` records the lon/lat of the footprint's south-west bounding-box corner (derived from your `buildings.geojson`), the meters-per-degree factors used, and `rotation_deg: 0`. It exists only so you can later place the floor plan on a map. Treat it as approximate: the local-meter conversion uses a flat-earth approximation at latitude 33.937, adequate at building scale.

## Per-floor
Same footprint, same `viewBox`, same coordinates for elevator shafts and stairwells on floors 1-3 (validated). Elevator/stair nodes have identical x/y on every floor.

## SVG structure (per floor)
Groups, in drawing order: `layer_annotations`, `layer_footprint`, `layer_hallways`, `layer_rooms`, `layer_walls_interior`, `layer_walls_exterior`, `layer_doors`, `layer_stairs`, `layer_elevators`, `layer_ramps`, `layer_accessibility` (entrances, fountains, accessible-route overlay), `layer_obstacles`, `layer_labels`, `layer_nav_graph` (hidden debug nodes/edges, `svgnode_<node_id>` / `svgedge_<edge_id>`), `route_layer` (empty; draw routes here), `layer_legend`.
