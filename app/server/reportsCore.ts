// Shared obstacle-report service, independent of where the reports are kept.
//  - Local demo: the Vite dev server keeps them in a JSON file (server/reportsApi.ts).
//  - Public deployment: a Cloudflare Pages Function keeps them in D1 (functions/api/[[path]].ts).
// Both use the SAME validation and the SAME review rules (verifyReport / rejectReport / resolveReport from the app).
// Nothing here decides routing. No Node-only or Cloudflare-only APIs are used in this file.
import {
  isReport, cleanSuggestion, verifyReport, rejectReport, resolveReport,
  REPORT_CATEGORIES, SEVERITY_FOR_REVIEW, MAX_DESCRIPTION,
  type ObstacleReport, type ReportCategory, type ConfirmedSeverity,
} from "../src/reports/obstacleReports";

export interface ReportsFile { schema: "ksu-nav.obstacle-reports"; version: 1; revision: number; updated_at: string; reports: ObstacleReport[] }
export interface ReportsSnapshot { revision: number; reports: ObstacleReport[] }
export type ReviewRequest =
  | { action: "verify"; category: ReportCategory; severity: ConfirmedSeverity; note?: string }
  | { action: "reject"; note?: string }
  | { action: "resolve"; note?: string };

export const MAX_REPORTS = 500;
export const MAX_BODY_BYTES = 32 * 1024;

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export const emptyReportsFile = (): ReportsFile => ({ schema: "ksu-nav.obstacle-reports", version: 1, revision: 0, updated_at: new Date(0).toISOString(), reports: [] });

/** Where the reports document lives. `save` must only succeed while the stored revision still equals `expectedRevision`. */
export interface ReportsStorage {
  load(): Promise<ReportsFile | null>;
  save(next: ReportsFile, expectedRevision: number): Promise<boolean>;
}
export type EdgeIndex = Map<string, { floor_id: string | null; domain: string; vertical: boolean }>;

export function createReportsService(storage: ReportsStorage, edgeIndex: () => Promise<EdgeIndex | null> = async () => null) {
  let queue: Promise<unknown> = Promise.resolve();                    // one change at a time within this process

  async function read(): Promise<ReportsFile> {
    const d = (await storage.load()) ?? emptyReportsFile();
    return { ...emptyReportsFile(), ...d, reports: d.reports.filter(isReport).map(cleanSuggestion) };   // anything inconsistent is dropped, never trusted
  }

  /** read, change, save if nobody else saved in between (retried a few times: another server instance may write too) */
  function mutate(change: (reports: ObstacleReport[]) => Promise<ObstacleReport[]> | ObstacleReport[]): Promise<ReportsSnapshot> {
    const run = queue.then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const d = await read();
        const reports = await change(d.reports);
        const next: ReportsFile = { ...d, revision: d.revision + 1, updated_at: new Date().toISOString(), reports };
        if (await storage.save(next, d.revision)) return { revision: next.revision, reports };
      }
      throw new ApiError(503, "The reports are busy. Please try again.");
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function validateNew(body: unknown): Promise<ObstacleReport> {
    const r = body as ObstacleReport;
    if (!isReport(r) || r.status !== "pending" || r.verified !== false || r.review !== undefined || r.source !== "user_report")
      throw new ApiError(400, "Not a valid new report: a new report must be pending, unverified and have no review.");
    if (!/^RPT-[A-Z0-9-]{4,40}$/.test(r.report_id)) throw new ApiError(400, "Invalid report_id.");
    if (!/^BLD\d{3}_F\d{1,2}$/.test(r.floor_id)) throw new ApiError(400, "Invalid floor_id.");
    const text = r.description.trim();
    if (!text || text.length > MAX_DESCRIPTION) throw new ApiError(400, `The description must be 1-${MAX_DESCRIPTION} characters.`);
    if (typeof r.location_label !== "string" || r.location_label.length > 120 || Number.isNaN(Date.parse(r.created_at)))
      throw new ApiError(400, "Invalid location_label or created_at.");
    const idx = await edgeIndex();
    if (idx) {
      const e = idx.get(r.affected_edge_id);
      if (!e || e.domain !== "indoor" || e.vertical || e.floor_id !== r.floor_id) throw new ApiError(400, "affected_edge_id is not a walkable segment on that floor.");
    }
    return { ...r, description: text };
  }

  function validateReview(body: unknown): ReviewRequest {
    const b = (body ?? {}) as Record<string, unknown>;
    const note = typeof b.note === "string" ? b.note.slice(0, MAX_DESCRIPTION) : "";
    if (b.action === "verify") {
      if (typeof b.category !== "string" || !(b.category in REPORT_CATEGORIES)) throw new ApiError(400, "verify needs a valid category.");
      if (!SEVERITY_FOR_REVIEW.includes(b.severity as ConfirmedSeverity)) throw new ApiError(400, "verify needs a severity: blocks_everyone, blocks_wheelchair or minor.");
      return { action: "verify", category: b.category as ReportCategory, severity: b.severity as ConfirmedSeverity, note };
    }
    if (b.action === "reject" || b.action === "resolve") return { action: b.action, note };
    throw new ApiError(400, "action must be verify, reject or resolve.");
  }

  return {
    get: (): Promise<ReportsSnapshot> => queue.then(read).then(d => ({ revision: d.revision, reports: d.reports })),
    add: async (body: unknown) => {
      const r = await validateNew(body);
      return mutate(list => {
        if (list.some(x => x.report_id === r.report_id)) throw new ApiError(409, "A report with this id already exists.");
        if (list.length >= MAX_REPORTS) throw new ApiError(409, `The demo holds at most ${MAX_REPORTS} reports. Clear some first.`);
        return [...list, r];
      });
    },
    review: async (id: string, body: unknown) => {
      const req = validateReview(body);                                // a bad request rejects the promise, like every other error here
      return mutate(list => {
        const i = list.findIndex(x => x.report_id === id);
        if (i < 0) throw new ApiError(404, `No report ${id}.`);
        const r = list[i];
        let next: ObstacleReport;
        try {                                                          // the app's own transition rules
          next = req.action === "verify" ? verifyReport(r, req.category, req.severity, req.note)
            : req.action === "reject" ? rejectReport(r, req.note) : resolveReport(r, req.note);
        } catch (e) { throw new ApiError(409, e instanceof Error ? e.message : String(e), { status: r.status }); }
        return list.map((x, j) => (j === i ? next : x));
      });
    },
    clear: () => mutate(() => []),
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;

// ---------------------------------------------------------------- web-standard HTTP (Cloudflare Pages Functions)
export interface FetchOptions {
  /** when set, reviewing and clearing need this passcode in the X-Reviewer-Passcode header (public deployment) */
  reviewPasscode?: string;
  /** public deployment: reviewing and clearing are refused outright if no passcode is configured (fail closed) */
  requirePasscode?: boolean;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** compare without returning early, so the time taken does not reveal how much of the passcode was right */
export function samePasscode(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0 && b.length > 0;
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "Send JSON (Content-Type: application/json).");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "Request too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, "Request too large.");
  try { return JSON.parse(text || "null"); } catch { throw new ApiError(400, "Body is not valid JSON."); }
}

/** /api/reports for the public deployment. Anything else under /api answers 404 (there is no /api/network there). */
export async function handleReportsFetch(request: Request, service: ReportsService, opts: FetchOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/reports\/([^/]+)\/review$/);
  const needsPasscode = () => {
    if (!opts.reviewPasscode) {
      if (opts.requirePasscode) throw new ApiError(503, "Reviewing is not set up on this server yet (no reviewer passcode is configured).");
      return;
    }
    if (!samePasscode(request.headers.get("x-reviewer-passcode") ?? "", opts.reviewPasscode)) throw new ApiError(401, "Reviewer passcode required.", { needsPasscode: true });
  };
  try {
    if (url.pathname === "/api/reports" && request.method === "GET") {
      const snap = await service.get(), since = Number(url.searchParams.get("since"));
      return json(200, url.searchParams.has("since") && since === snap.revision ? { revision: snap.revision, unchanged: true } : snap);
    }
    if (url.pathname === "/api/reports" && request.method === "POST") return json(201, await service.add(await readJsonBody(request)));
    if (url.pathname === "/api/reports" && request.method === "DELETE") { needsPasscode(); return json(200, await service.clear()); }
    if (m && request.method === "POST") { needsPasscode(); return json(200, await service.review(decodeURIComponent(m[1]), await readJsonBody(request))); }
    if (url.pathname === "/api/reports" || m) return json(405, { error: "Method not allowed." });
    return json(404, { error: "Not found." });
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: e.message, ...e.extra });
    console.error("[reports api]", e);
    return json(500, { error: "The reports could not be read or saved. Please try again." });
  }
}
