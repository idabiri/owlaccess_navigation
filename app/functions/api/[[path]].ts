// Cloudflare Pages Function: /api/* for the PUBLIC deployment of OwlAccess.
// Same rules as the local dev server (server/reportsCore.ts), storage in D1, and reviewing/clearing behind a passcode
// kept as a Cloudflare secret (REVIEW_PASSCODE), never in the website's code. There is no /api/network here.
import { createReportsService, handleReportsFetch, type EdgeIndex } from "../../server/reportsCore";
import { d1Storage, type D1Like } from "../../server/d1Storage";

interface Env {
  REPORTS_DB: D1Like;                                   // D1 binding (wrangler.toml)
  REVIEW_PASSCODE?: string;                             // secret: `npx wrangler pages secret put REVIEW_PASSCODE`
  ASSETS: { fetch(input: Request | string): Promise<Response> };
}
let edges: EdgeIndex | null = null;                      // the routing graph's edges, cached per instance

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const service = createReportsService(d1Storage(env.REPORTS_DB), async () => {
    if (!edges) {
      const res = await env.ASSETS.fetch(new URL("/data/unified_routing_graph.json", request.url).toString());
      if (!res.ok) return null;
      const g = (await res.json()) as { edges: { edge_id: string; floor_id: string | null; domain: string; vertical: boolean }[] };
      edges = new Map(g.edges.map(e => [e.edge_id, e]));
    }
    return edges;
  });
  return handleReportsFetch(request, service, { reviewPasscode: env.REVIEW_PASSCODE, requirePasscode: true });
};
