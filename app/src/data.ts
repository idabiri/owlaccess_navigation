import type { UnifiedData } from "./routing/unifiedRouting";

export interface OutdoorEdge { edge_id: string; from_node: string; to_node: string; edge_type: string; stairs_only: boolean; geometry: [number, number][] }
export interface Connector { connector_id: string; indoor_feature_id: string; status: string; verification_status: string; outdoor_node_id: string | null; reason: string | null }
export interface BuildingFeature { type: "Feature"; geometry: { type: "Polygon"; coordinates: [number, number][][] }; properties: { id: string; name: string | null; building_id: string | null; indoor_mapping: boolean | null } }
export interface AppData { unified: UnifiedData; outdoorEdges: OutdoorEdge[]; buildings: BuildingFeature[]; svgs: Record<number, string>; connectors: Connector[] }

export async function loadAppData(base = import.meta.env.BASE_URL + "data/"): Promise<AppData> {
  const j = async (f: string) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); };
  const t = async (f: string) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); };
  const [unified, oe, b, c, s1, s2, s3] = await Promise.all([j("unified_routing_graph.json"), j("outdoor_edges.json"), j("buildings_marietta.geojson"), j("indoor_outdoor_connectors.json"), t("floor_1.svg"), t("floor_2.svg"), t("floor_3.svg")]);
  return { unified: withDisplayLabels(unified), outdoorEdges: oe.edges, buildings: b.features, connectors: c.connectors, svgs: { 1: s1, 2: s2, 3: s3 } };
}

/** Plain names for places people pick, applied in memory after loading. The data files (and their ids) are not changed.
 *  The stored labels are survey codes ("Outdoor ENT007 (provisional)"), which mean nothing to a visitor.
 *  - ENT007 and ENT008: named by the project owner (Academic Building Entrance; Engineering Technology Center Entrance).
 *    ENT008 comes from a malformed source row ("ENT" / "008"); the owner confirmed which entrance it is.
 *  - RMP004: the source row is a ramp at the Academic Building.
 *  - entrance_1..4: synthetic doors inside the Academic Building, placed from ENT006, ENT007 and RMP004 (entrance_4 is an
 *    invented entrance with steps). Their side of the building comes from the synthetic floor plan (north is up).
 *  Positions stay provisional: the pickers group these places under headings that say so. */
export const DISPLAY_LABELS: Record<string, string> = {
  oe_ENT007: "Academic Building Entrance",
  oe_ENT008: "Engineering Technology Center Entrance",
  oe_RMP004: "Academic Building Ramp",
  entrance_2: "Academic Building Entrance, inside the door",
  entrance_3: "Academic Building Ramp entrance, inside",
  entrance_1: "Academic Building northwest entrance, inside",
  entrance_4: "Academic Building southwest entrance, inside (has steps)",
};
export function withDisplayLabels(unified: UnifiedData): UnifiedData {
  return { ...unified, endpoints_meta: unified.endpoints_meta.map(m => (DISPLAY_LABELS[m.id] ? { ...m, label: DISPLAY_LABELS[m.id] } : m)) };
}
