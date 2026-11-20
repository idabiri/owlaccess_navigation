// The shared report store: every device talks to /api/reports. Locally that is the Vite dev server (one JSON file on the
// laptop); in the public deployment it is a Cloudflare Pages Function (D1). Every response is re-checked here before it is shown.
import type { ReportsSnapshot, ReviewRequest } from "../../server/reportsCore";
import { isReport, cleanSuggestion, type ObstacleReport } from "./obstacleReports";

export type { ReportsSnapshot, ReviewRequest };
export class StoreError extends Error {
  /** needsPasscode: the server asks for the reviewer passcode (public deployment only) */
  constructor(public status: number, message: string, public needsPasscode = false) { super(message); }
}
export interface ReportStore {
  load(): Promise<ReportsSnapshot>;
  add(report: ObstacleReport): Promise<ReportsSnapshot>;
  review(id: string, request: ReviewRequest): Promise<ReportsSnapshot>;
  clear(): Promise<ReportsSnapshot>;
  /** call onChange whenever the shared reports change (checked every `everyMs` while the tab is visible, and as soon as it is shown again); onError(null) means it recovered */
  watch(onChange: (s: ReportsSnapshot) => void, onError: (message: string | null) => void, everyMs?: number): () => void;
  reviewerUrls(): Promise<string[]>;
  /** the reviewer passcode, kept for this tab only and sent with review and clear requests */
  setReviewerPasscode?(code: string | null): void;
}

const clean = (s: ReportsSnapshot): ReportsSnapshot => ({ revision: s.revision, reports: (Array.isArray(s.reports) ? s.reports : []).filter(isReport).map(cleanSuggestion) });
const PASS_KEY = "owlaccess.reviewer-passcode";
const session = (): Storage | null => { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } };

export function httpReportStore(base = "/api", fetchFn: typeof fetch = (...a) => fetch(...a)): ReportStore {
  let revision = -1;
  let passcode: string | null = (() => { try { return session()?.getItem(PASS_KEY) ?? null; } catch { return null; } })();
  async function call<T>(method: string, path: string, body?: unknown, reviewer = false): Promise<T> {
    let res: Response;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (reviewer && passcode) headers["X-Reviewer-Passcode"] = passcode;
    try {
      res = await fetchFn(base + path, { method, cache: "no-store", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new StoreError(0, "Can't reach the reports server. Check your connection. (Local demo: is the dev server running, and is this device on the same Wi-Fi?)"); }
    let data: unknown = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const d = data as { error?: string; needsPasscode?: boolean } | null;
      throw new StoreError(res.status, d?.error ?? `The server answered ${res.status}.`, res.status === 401 && !!d?.needsPasscode);
    }
    return data as T;
  }
  const snap = async (p: Promise<ReportsSnapshot>) => { const s = clean(await p); revision = s.revision; return s; };
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  return {
    load: () => snap(call("GET", "/reports")),
    add: r => snap(call("POST", "/reports", r)),
    review: (id, request) => snap(call("POST", `/reports/${encodeURIComponent(id)}/review`, request, true)),
    clear: () => snap(call("DELETE", "/reports", undefined, true)),
    reviewerUrls: async () => { try { return (await call<{ reviewerUrls: string[] }>("GET", "/network")).reviewerUrls ?? []; } catch { return []; } },
    setReviewerPasscode(code) {
      passcode = code && code.trim() ? code.trim() : null;
      try { const s = session(); if (passcode) s?.setItem(PASS_KEY, passcode); else s?.removeItem(PASS_KEY); } catch { /* storage blocked: kept in memory */ }
    },
    watch(onChange, onError, everyMs = 3000) {
      let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, failing = false, busy = false;
      const tick = async () => {
        if (stopped || busy) return;
        if (hidden()) { timer = setTimeout(tick, everyMs); return; }       // a hidden tab asks nothing (saves free-tier requests)
        busy = true;
        try {
          const r = await call<ReportsSnapshot & { unchanged?: boolean }>("GET", `/reports?since=${revision}`);
          if (failing) { failing = false; onError(null); }
          if (!r.unchanged && !stopped) { const s = clean(r); revision = s.revision; onChange(s); }
        } catch (e) { failing = true; if (!stopped) onError(e instanceof Error ? e.message : String(e)); }
        finally { busy = false; if (!stopped) timer = setTimeout(tick, everyMs); }
      };
      const onVisible = () => { if (!hidden()) { clearTimeout(timer); void tick(); } };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      timer = setTimeout(tick, everyMs);
      return () => { stopped = true; clearTimeout(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible); };
    },
  };
}
