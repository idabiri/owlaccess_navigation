import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppData } from "../src/data";
const P = resolve(__dirname, "../public/data/");
const J = (f: string) => JSON.parse(readFileSync(resolve(P, f), "utf8"));
export function loadFixtureData(): AppData {
  return { unified: J("unified_routing_graph.json"), outdoorEdges: J("outdoor_edges.json").edges, buildings: J("buildings_marietta.geojson").features, connectors: J("indoor_outdoor_connectors.json").connectors,
    svgs: { 1: readFileSync(resolve(P, "floor_1.svg"), "utf8"), 2: readFileSync(resolve(P, "floor_2.svg"), "utf8"), 3: readFileSync(resolve(P, "floor_3.svg"), "utf8") } };
}
