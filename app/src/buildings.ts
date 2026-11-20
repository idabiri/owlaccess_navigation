import type { AppData } from "./data";

/** A building the app knows by id. Only buildings with an indoor package have floors; the rest are outdoor-only. */
export interface BuildingInfo { id: string; name: string; shortName: string; hasIndoor: boolean; floors: number[] }

/** Buildings from buildings_marietta.geojson that carry a building_id, sorted with indoor-mapped ones first. */
export function listBuildings(data: AppData): BuildingInfo[] {
  const indoorFloors = Object.keys(data.svgs).map(Number).sort((a, b) => a - b);   // floor SVGs exist for BLD001 only
  return data.buildings
    .filter(f => f.properties.building_id)
    .map(f => {
      const id = f.properties.building_id as string, name = f.properties.name ?? id;
      const hasIndoor = f.properties.indoor_mapping === true && id === "BLD001";
      return { id, name, shortName: name.replace(/^[A-Z]\d?\s*-\s*/, ""), hasIndoor, floors: hasIndoor ? indoorFloors : [] };
    })
    .sort((a, b) => Number(b.hasIndoor) - Number(a.hasIndoor) || a.name.localeCompare(b.name));
}
