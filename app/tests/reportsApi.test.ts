// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createReportsRepo, reportsMiddleware, privateNetworkOnly, isPrivateAddress, ApiError, type ReportsRepo } from "../server/reportsApi";
import { httpReportStore } from "../src/reports/reportStore";
import { createReport, snapToEdge, verifyReport, blockingObstacles } from "../src/reports/obstacleReports";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const GRAPH = path.resolve(__dirname, "../public/data/unified_routing_graph.json");
const draft = snapToEdge(data.unified, "BLD001_F1", 275, 440.5)!;                  // corridor e_f1_051
const newReport = (text = "Boxes in the corridor") => createReport(draft, "blocked_hallway", text, { severity: "blocks_wheelchair" });

let dir: string, file: string, repo: ReportsRepo;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "ksu-reports-")); file = path.join(dir, "obstacle_reports.json"); repo = createReportsRepo({ file, graphFile: GRAPH }); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const rejects = async (p: Promise<unknown>, status: number) => { await expect(p).rejects.toBeInstanceOf(ApiError); await p.catch(e => expect((e as ApiError).status).toBe(status)); };

describe("reports file: the shared store", () => {
  it("starts empty, saves a pending report to the JSON file and counts revisions", async () => {
    expect(await repo.get()).toEqual({ revision: 0, reports: [] });
    const r = newReport(), s = await repo.add(r);
    expect(s.revision).toBe(1); expect(s.reports).toEqual([r]);
    const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(onDisk).toMatchObject({ schema: "ksu-nav.obstacle-reports", revision: 1, reports: [r] });
  });
  it("applies the app's own review rules: verify -> verified; a second decision is refused (409)", async () => {
    const r = newReport(); await repo.add(r);
    const s = await repo.review(r.report_id, { action: "verify", category: "blocked_hallway", severity: "blocks_everyone", note: "seen" });
    expect(s.reports[0]).toMatchObject({ status: "verified", verified: true, review: { severity: "blocks_everyone", note: "seen" } });
    await rejects(repo.review(r.report_id, { action: "reject" }), 409);
    expect((await repo.review(r.report_id, { action: "resolve" })).reports[0].status).toBe("resolved");
  });
  it("reject -> rejected, and rejected/pending never block routes", async () => {
    const a = newReport("a"), b = newReport("b"); await repo.add(a); await repo.add(b);
    const s = await repo.review(a.report_id, { action: "reject", note: "not there" });
    expect(s.reports.map(r => r.status)).toEqual(["rejected", "pending"]);
    expect(blockingObstacles(s.reports, true)).toEqual([]); expect(blockingObstacles(s.reports, false)).toEqual([]);
  });
  it("validates input: forged status, wrong edge, bad fields, duplicates, unknown ids, bad review requests", async () => {
    const r = newReport();
    await rejects(repo.add(verifyReport(r, "blocked_hallway", "blocks_everyone")), 400);              // must arrive pending
    await rejects(repo.add({ ...r, verified: true }), 400);
    await rejects(repo.add({ ...r, affected_edge_id: "e_f2_001" }), 400);                              // edge on another floor
    await rejects(repo.add({ ...r, affected_edge_id: "no_such_edge" }), 400);
    await rejects(repo.add({ ...r, report_id: "<script>" }), 400);
    await rejects(repo.add({ ...r, description: "   " }), 400);
    await rejects(repo.add({ ...r, description: "x".repeat(301) }), 400);
    await rejects(repo.add(null), 400);
    await repo.add(r); await rejects(repo.add(r), 409);
    await rejects(repo.review("RPT-NOPE", { action: "reject" }), 404);
    await rejects(repo.review(r.report_id, { action: "verify", category: "blocked_hallway", severity: "unclear" } as never), 400);
    await rejects(repo.review(r.report_id, { action: "delete" } as never), 400);
    expect((await repo.get()).reports).toHaveLength(1);
  });
  it("never overwrites a damaged file", async () => {
    await fs.writeFile(file, "{ not json");
    await rejects(repo.get(), 500); await rejects(repo.add(newReport()), 500);
    expect(await fs.readFile(file, "utf8")).toBe("{ not json");
  });
  it("drops inconsistent records found in the file instead of trusting them", async () => {
    const good = newReport(), forged = { ...newReport("f"), status: "verified", verified: true };
    await fs.writeFile(file, JSON.stringify({ schema: "ksu-nav.obstacle-reports", version: 1, revision: 7, updated_at: "", reports: [good, forged] }));
    expect((await repo.get()).reports.map(r => r.report_id)).toEqual([good.report_id]);
  });
  it("concurrent changes are applied one after another, none lost", async () => {
    const many = Array.from({ length: 12 }, (_, i) => newReport(`r${i}`));
    await Promise.all(many.map(r => repo.add(r)));
    const s = await repo.get();
    expect(s.revision).toBe(12); expect(new Set(s.reports.map(r => r.report_id)).size).toBe(12);
  });
  it("clear empties the list", async () => { await repo.add(newReport()); expect((await repo.clear()).reports).toEqual([]); });
  it("accepts reports whose location was chosen from the list, for every place on every floor", async () => {
    const { listReportPlaces, draftFromPlace } = await import("../src/reports/obstacleReports");
    for (const f of ["BLD001_F1", "BLD001_F2", "BLD001_F3"]) for (const p of listReportPlaces(data.unified, f)) {
      await repo.add(createReport(draftFromPlace(data.unified, f, p.edge_id)!, "other", `at ${p.label}`));
    }
    expect((await repo.get()).reports.length).toBeGreaterThan(140);
  });
});

describe("network guard", () => {
  it.each([["127.0.0.1", true], ["::1", true], ["::ffff:192.168.1.20", true], ["10.0.0.5", true], ["172.16.0.1", true], ["172.31.255.1", true],
    ["169.254.3.3", true], ["fe80::1", true], ["fd12:3456::1", true], ["172.32.0.1", false], ["8.8.8.8", false], ["100.64.0.1", false], ["2001:4860::8888", false], [undefined, false]])(
    "%s -> %s", (addr, ok) => expect(isPrivateAddress(addr as string | undefined)).toBe(ok));
});

describe("HTTP API and the app's client (real local server)", () => {
  let server: http.Server, base: string;
  beforeEach(async () => {
    const guard = privateNetworkOnly(), api = reportsMiddleware(repo);
    server = http.createServer((req, res) => guard(req, res, () => api(req, res, () => { res.statusCode = 404; res.end("fallthrough"); })));
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterEach(async () => { await new Promise(r => server.close(r)); });
  const raw = (p: string, init?: RequestInit) => fetch(base + p, init);

  it("rejects non-JSON, broken JSON, oversized bodies and wrong methods with clear statuses", async () => {
    expect((await raw("/reports", { method: "POST", body: "x" })).status).toBe(415);
    expect((await raw("/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" })).status).toBe(400);
    expect((await raw("/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(40_000) }) })).status).toBe(413);
    expect((await raw("/reports", { method: "PUT" })).status).toBe(405);
    const r = await raw("/reports"); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(base.replace("/api", "/other"))).text()).toBe("fallthrough");          // other paths go on to Vite
  });
  it("'since' answers unchanged when nothing changed", async () => {
    expect(await (await raw("/reports?since=0")).json()).toEqual({ revision: 0, unchanged: true });
  });
  it("reports the laptop's private addresses for the phone link", async () => {
    const j = await (await raw("/network")).json();
    expect(Array.isArray(j.reviewerUrls)).toBe(true);
    for (const u of j.reviewerUrls) expect(u).toMatch(/^http:\/\/(10|172|192)\.[\d.]+:\d+\/review$/);
  });
  it("two clients (laptop + phone) see each other's changes; errors arrive as messages", async () => {
    const laptop = httpReportStore(base, fetch), phone = httpReportStore(base, fetch);
    const r = newReport();
    await laptop.add(r);
    expect((await phone.load()).reports.map(x => x.status)).toEqual(["pending"]);
    const seen: string[] = [];
    const stop = laptop.watch(s => seen.push(s.reports[0]?.status ?? "none"), () => undefined, 30);
    await phone.review(r.report_id, { action: "verify", category: "blocked_hallway", severity: "blocks_everyone" });
    await expect.poll(() => seen, { timeout: 2000, interval: 20 }).toContain("verified");
    stop();
    await expect(phone.review(r.report_id, { action: "verify", category: "blocked_hallway", severity: "minor" })).rejects.toMatchObject({ status: 409 });
    await expect(httpReportStore("http://127.0.0.1:1/api", fetch).load()).rejects.toMatchObject({ status: 0 });   // laptop unreachable
  });
});
