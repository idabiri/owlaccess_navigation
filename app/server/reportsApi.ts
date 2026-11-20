// Shared obstacle-report store for the LOCAL hackathon demo.
// A Vite plugin: the dev server (and `vite preview`) answers /api/reports from one JSON file on this laptop,
// so the laptop app and a phone on the same Wi-Fi see and change the same reports.
// The rules (validation, verify / reject / resolve) live in reportsCore.ts and are shared with the public deployment;
// this file only adds the JSON file, the private-network guard and the Vite plugin. Not a production server.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ApiError, MAX_BODY_BYTES, createReportsService, type ReportsFile, type ReportsStorage, type EdgeIndex } from "./reportsCore";

export { ApiError, MAX_REPORTS, MAX_BODY_BYTES, createReportsService, handleReportsFetch, samePasscode, emptyReportsFile } from "./reportsCore";
export type { ReportsFile, ReportsSnapshot, ReviewRequest, ReportsStorage, ReportsService, EdgeIndex } from "./reportsCore";

// ---------------------------------------------------------------- network guard
/** loopback, private (RFC 1918), link-local, and IPv6 unique-local / link-local. Everything else is refused. */
export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.toLowerCase().split("%")[0];
  if (a.startsWith("::ffff:")) a = a.slice(7);                         // IPv4 written as IPv6
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])];
    return p === 127 || p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254);
  }
  return a === "::1" || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}
export function privateNetworkOnly() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (isPrivateAddress(req.socket.remoteAddress)) return next();
    res.statusCode = 403; res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Forbidden: this local demo server only answers devices on the same private network.");
  };
}

// ---------------------------------------------------------------- the file
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The reports document as one JSON file. A damaged file is never overwritten. One process writes it (the dev server),
 *  and the service's own queue orders the writes, so the revision check is the file's revision at load time. */
export function fileStorage(file: string): ReportsStorage {
  return {
    async load() {
      let raw: string;
      try { raw = await fs.readFile(file, "utf8"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
      let d: ReportsFile;
      try { d = JSON.parse(raw); } catch { throw new ApiError(500, `The reports file ${path.basename(file)} is damaged (not valid JSON). It has not been changed; fix or delete it.`); }
      if (!d || typeof d.revision !== "number" || !Array.isArray(d.reports)) throw new ApiError(500, `The reports file ${path.basename(file)} has an unexpected shape. It has not been changed.`);
      return d;
    },
    /** write to a temporary file, then rename it into place (retrying briefly: OneDrive or antivirus may hold the file) */
    async save(next) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
      for (let i = 0; ; i++) {
        try { await fs.rename(tmp, file); return true; }
        catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (i >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) { await fs.rm(tmp, { force: true }); throw e; }
          await sleep(50);
        }
      }
    },
  };
}

export interface RepoOptions { file: string; graphFile?: string }
/** The local demo store: the shared service over the JSON file, checking new reports against the routing graph. */
export function createReportsRepo({ file, graphFile }: RepoOptions) {
  let edges: EdgeIndex | null = null;
  return createReportsService(fileStorage(file), async () => {
    if (!graphFile) return null;
    if (!edges) {
      const g = JSON.parse(await fs.readFile(graphFile, "utf8"));
      edges = new Map(g.edges.map((e: { edge_id: string; floor_id: string | null; domain: string; vertical: boolean }) => [e.edge_id, e]));
    }
    return edges;
  });
}
export type ReportsRepo = ReturnType<typeof createReportsRepo>;

// ---------------------------------------------------------------- HTTP
function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return reject(new ApiError(415, "Send JSON (Content-Type: application/json)."));
    let size = 0, tooBig = false; const chunks: Buffer[] = [];
    // past the limit, the rest is read and dropped (not kept), so that the 413 answer can still be sent
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY_BYTES) { if (!tooBig) { tooBig = true; chunks.length = 0; reject(new ApiError(413, "Request too large.")); } } else chunks.push(c); });
    req.on("end", () => { if (tooBig) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); } catch { reject(new ApiError(400, "Body is not valid JSON.")); } });
    req.on("error", reject);
  });
}

/** This laptop's private IPv4 addresses, for the "open this on your phone" link. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal && isPrivateAddress(i.address) && !i.address.startsWith("169.254."))
    .map(i => i.address);
}

export function reportsMiddleware(repo: ReportsRepo) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/api/network" && req.method === "GET") {
      const port = (req.headers.host ?? "").split(":")[1] ?? "5173";
      return send(res, 200, { reviewerUrls: lanAddresses().map(a => `http://${a}:${port}/review`) });
    }
    if (url.pathname !== "/api/reports" && !url.pathname.startsWith("/api/reports/")) return next();
    try {
      const m = url.pathname.match(/^\/api\/reports\/([^/]+)\/review$/);
      if (url.pathname === "/api/reports" && req.method === "GET") {
        const snap = await repo.get(), since = Number(url.searchParams.get("since"));
        return send(res, 200, url.searchParams.has("since") && since === snap.revision ? { revision: snap.revision, unchanged: true } : snap);
      }
      if (url.pathname === "/api/reports" && req.method === "POST") return send(res, 201, await repo.add(await readJson(req)));
      if (url.pathname === "/api/reports" && req.method === "DELETE") return send(res, 200, await repo.clear());
      if (m && req.method === "POST") return send(res, 200, await repo.review(decodeURIComponent(m[1]), await readJson(req)));
      if (url.pathname === "/api/reports" || m) return send(res, 405, { error: "Method not allowed." });
      return send(res, 404, { error: "Not found." });
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.message, ...e.extra });
      console.error("[reports api]", e);
      return send(res, 500, { error: "The reports could not be read or saved on the laptop. See the dev server's terminal." });
    }
  };
}

export function reportsApiPlugin(opts: RepoOptions): Plugin {
  const install = (use: (fn: ReturnType<typeof reportsMiddleware>) => void) => { const repo = createReportsRepo(opts); use(privateNetworkOnly() as never); use(reportsMiddleware(repo)); };
  return {
    name: "ksu-reports-api",
    configureServer(server) { install(fn => server.middlewares.use(fn)); },          // registered first: guards every request
    configurePreviewServer(server) { install(fn => server.middlewares.use(fn)); },
  };
}
