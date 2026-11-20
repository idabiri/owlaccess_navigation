// @vitest-environment node
// The public-deployment code path: Cloudflare Pages Function + D1, tested with an in-memory stand-in for D1.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { onRequest } from "../functions/api/[[path]]";
import { createReportsService, samePasscode } from "../server/reportsCore";
import { d1Storage, type D1Like } from "../server/d1Storage";
import { createReport, snapToEdge } from "../src/reports/obstacleReports";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const GRAPH = readFileSync(path.resolve(__dirname, "../public/data/unified_routing_graph.json"), "utf8");
const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;
const newReport = (t = "Boxes in the corridor") => createReport(draft, "blocked_hallway", t, { severity: "blocks_wheelchair" });

/** just enough of D1 for d1Storage: one row, UPDATE ... WHERE revision = ?, INSERT OR IGNORE. Each call yields, so writers can interleave. */
function fakeD1() {
  let row: { revision: number; updated_at: string; body: string } | null = null;
  const tick = () => new Promise(r => setTimeout(r, 0));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => { await tick(); return sql.startsWith("SELECT") && row ? { ...row } : null; },
    run: async () => {
      await tick();
      if (sql.startsWith("UPDATE")) { if (row && row.revision === args[3]) { row = { revision: args[0] as number, updated_at: args[1] as string, body: args[2] as string }; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      if (sql.startsWith("INSERT")) { if (!row) { row = { revision: args[0] as number, updated_at: args[1] as string, body: args[2] as string }; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      throw new Error("unexpected SQL " + sql);
    },
  });
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Like, peek: () => row };
}

let d1: ReturnType<typeof fakeD1>;
const env = (extra: Record<string, unknown> = {}) => ({
  REPORTS_DB: d1.db, REVIEW_PASSCODE: "owl-2026",
  ASSETS: { fetch: async () => new Response(GRAPH, { headers: { "Content-Type": "application/json" } }) }, ...extra,
});
const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}, e = env()) =>
  onRequest({ request: new Request("https://owlaccess.example" + p, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env: e as never });
beforeEach(() => { d1 = fakeD1(); });

describe("public deployment: Pages Function + D1", () => {
  it("anyone can read and submit reports; they are stored in D1 as pending", async () => {
    expect(await (await call("GET", "/api/reports")).json()).toEqual({ revision: 0, reports: [] });
    const r = newReport(), res = await call("POST", "/api/reports", r);
    expect(res.status).toBe(201);
    expect(JSON.parse(d1.peek()!.body)).toMatchObject([{ report_id: r.report_id, status: "pending" }]);
    expect((await (await call("GET", "/api/reports?since=1")).json())).toEqual({ revision: 1, unchanged: true });
  });
  it("reviewing and clearing need the reviewer passcode (401 without or with a wrong one)", async () => {
    const r = newReport(); await call("POST", "/api/reports", r);
    const verify = { action: "verify", category: "blocked_hallway", severity: "blocks_everyone" };
    const none = await call("POST", `/api/reports/${r.report_id}/review`, verify);
    expect(none.status).toBe(401); expect(await none.json()).toMatchObject({ needsPasscode: true });
    expect((await call("POST", `/api/reports/${r.report_id}/review`, verify, { "X-Reviewer-Passcode": "guess" })).status).toBe(401);
    expect((await call("DELETE", "/api/reports")).status).toBe(401);
    const ok = await call("POST", `/api/reports/${r.report_id}/review`, verify, { "X-Reviewer-Passcode": "owl-2026" });
    expect(ok.status).toBe(200); expect((await ok.json()).reports[0]).toMatchObject({ status: "verified", verified: true });
    expect((await call("DELETE", "/api/reports", undefined, { "X-Reviewer-Passcode": "owl-2026" })).status).toBe(200);
  });
  it("fails closed: with no passcode configured, reviewing and clearing are refused (503), submitting still works", async () => {
    const e = env({ REVIEW_PASSCODE: undefined }), r = newReport();
    expect((await call("POST", "/api/reports", r, {}, e)).status).toBe(201);
    expect((await call("POST", `/api/reports/${r.report_id}/review`, { action: "reject" }, { "X-Reviewer-Passcode": "" }, e)).status).toBe(503);
    expect((await call("DELETE", "/api/reports", undefined, {}, e)).status).toBe(503);
  });
  it("validates like the local server (forged status, wrong edge) and exposes no /api/network", async () => {
    const r = newReport();
    expect((await call("POST", "/api/reports", { ...r, status: "verified", verified: true })).status).toBe(400);
    expect((await call("POST", "/api/reports", { ...r, affected_edge_id: "e_f2_001" })).status).toBe(400);
    expect((await call("POST", "/api/reports", "x".repeat(40_000))).status).toBe(413);
    expect((await call("GET", "/api/network")).status).toBe(404);
  });
  it("two server instances writing at once lose nothing (compare-and-swap on the revision)", async () => {
    const a = createReportsService(d1Storage(d1.db)), b = createReportsService(d1Storage(d1.db));
    const rs = Array.from({ length: 6 }, (_, i) => newReport(`r${i}`));
    await Promise.all(rs.map((r, i) => (i % 2 ? a : b).add(r)));
    const s = await a.get();
    expect(new Set(s.reports.map(r => r.report_id)).size).toBe(6); expect(s.revision).toBe(6);
  });
  it("passcode comparison", () => {
    expect(samePasscode("owl-2026", "owl-2026")).toBe(true);
    expect(samePasscode("owl-2025", "owl-2026")).toBe(false); expect(samePasscode("", "")).toBe(false); expect(samePasscode("owl", "owl-2026")).toBe(false);
  });
});
