// The reports document in Cloudflare D1 (public deployment). One row holds the whole document, like the local JSON file.
// Saving is compare-and-swap on the revision, so two Function instances writing at once cannot lose each other's change:
// the loser's save returns false and the shared service retries with the fresh document.
import { ApiError, type ReportsFile, type ReportsStorage } from "./reportsCore";

/** the small part of Cloudflare's D1Database this file uses (kept local so no Cloudflare type package is needed) */
export interface D1Like {
  prepare(query: string): { bind(...values: unknown[]): D1Statement } & D1Statement;
}
interface D1Statement {
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export const D1_SCHEMA = `CREATE TABLE IF NOT EXISTS report_doc (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);`;

export function d1Storage(db: D1Like): ReportsStorage {
  return {
    async load(): Promise<ReportsFile | null> {
      const row = await db.prepare("SELECT revision, updated_at, body FROM report_doc WHERE id = 1").first<{ revision: number; updated_at: string; body: string }>();
      if (!row) return null;
      let reports: unknown;
      try { reports = JSON.parse(row.body); } catch { throw new ApiError(500, "The stored reports are damaged. They have not been changed."); }
      return { schema: "ksu-nav.obstacle-reports", version: 1, revision: row.revision, updated_at: row.updated_at, reports: Array.isArray(reports) ? reports : [] };
    },
    async save(next, expectedRevision) {
      const body = JSON.stringify(next.reports);
      const upd = await db.prepare("UPDATE report_doc SET revision = ?, updated_at = ?, body = ? WHERE id = 1 AND revision = ?")
        .bind(next.revision, next.updated_at, body, expectedRevision).run();
      if ((upd.meta?.changes ?? 0) === 1) return true;
      if (expectedRevision !== 0) return false;                                   // someone else saved first
      const ins = await db.prepare("INSERT OR IGNORE INTO report_doc (id, revision, updated_at, body) VALUES (1, ?, ?, ?)")
        .bind(next.revision, next.updated_at, body).run();
      return (ins.meta?.changes ?? 0) === 1;
    },
  };
}
