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

/** Display-only label fixes, applied in memory after loading. The data files are not changed.
 *  oe_ENT008 comes from the malformed source row (feature_id "ENT", feature_type "008"), so its stored label reads "Outdoor ENT".
 *  The ENT008 identity is still a proposed correction (entrance_review.json), so the label says so. */
export function withDisplayLabels(unified: UnifiedData): UnifiedData {
  const fixes: Record<string, string> = { oe_ENT008: "Outdoor ENT008 (provisional, ID pending review)" };
  return { ...unified, endpoints_meta: unified.endpoints_meta.map(m => (fixes[m.id] ? { ...m, label: fixes[m.id] } : m)) };
}
