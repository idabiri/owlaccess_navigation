// Facts about the data, computed from the loaded files (never typed in by hand), for the landing and About pages.
import type { AppData } from "../data";

export interface DataFacts {
  outdoorSegments: number; outdoorKm: number; outdoorSteps: number; buildings: number; namedBuildings: number;
  indoorFloors: number; indoorRooms: number; indoorSegments: number; narrowSegments: number;
  entrances: { indoor: number; connected: number; connectedVerified: number; connectedProvisional: number };
  demoObstacles: number;
}
export function dataFacts(data: AppData): DataFacts {
  const u = data.unified;
  const outdoor = u.edges.filter(e => e.domain === "outdoor"), indoor = u.edges.filter(e => e.domain === "indoor");
  const connected = data.connectors.filter(c => c.outdoor_node_id);
  return {
    outdoorSegments: outdoor.length,
    outdoorKm: Math.round(outdoor.reduce((s, e) => s + e.distance, 0) / 100) / 10,
    outdoorSteps: outdoor.filter(e => e.stairs_only || e.edge_type === "steps").length,
    buildings: data.buildings.length, namedBuildings: data.buildings.filter(b => b.properties.name).length,
    indoorFloors: Object.keys(data.svgs).length,
    indoorRooms: u.endpoints_meta.filter(m => m.kind === "room").length,
    indoorSegments: indoor.length, narrowSegments: u.edges.filter(e => e.potentially_narrow).length,
    entrances: {
      indoor: u.endpoints_meta.filter(m => m.kind === "building_entrance").length,
      connected: connected.length,
      connectedVerified: connected.filter(c => c.verification_status === "verified").length,
      connectedProvisional: connected.filter(c => c.verification_status !== "verified").length,
    },
    demoObstacles: u.obstacles.length,
  };
}
