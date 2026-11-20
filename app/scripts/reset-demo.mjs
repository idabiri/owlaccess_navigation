// Reset the shared demo reports before judging:  npm run demo:reset
// Empties data/obstacle_reports.json (the file the dev server shares with the phone reviewer).
// Any reports that were there are first copied to data/obstacle_reports.backup-<time>.json, so nothing is lost.
// Safe while the dev server runs: open pages pick up the empty list within a few seconds.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const file = path.join(dataDir, "obstacle_reports.json");

let revision = 0, count = 0;
try {
  const raw = await fs.readFile(file, "utf8");
  const d = JSON.parse(raw);
  revision = Number.isFinite(d.revision) ? d.revision : 0;
  count = Array.isArray(d.reports) ? d.reports.length : 0;
  if (count > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(dataDir, `obstacle_reports.backup-${stamp}.json`);
    await fs.writeFile(backup, raw, "utf8");
    console.log(`Saved the ${count} existing report(s) to ${path.relative(process.cwd(), backup)}`);
  }
} catch (e) {
  if (e.code !== "ENOENT") { console.error(`Could not read ${file}: ${e.message}\nNothing was changed.`); process.exit(1); }
}

await fs.mkdir(dataDir, { recursive: true });
const empty = { schema: "ksu-nav.obstacle-reports", version: 1, revision: revision + 1, updated_at: new Date().toISOString(), reports: [] };
const tmp = `${file}.${process.pid}.tmp`;
await fs.writeFile(tmp, JSON.stringify(empty, null, 2) + "\n", "utf8");
await fs.rename(tmp, file);
console.log(count > 0 ? `Cleared ${count} report(s). The demo starts with no reports.` : "No reports to clear. The demo starts with no reports.");
