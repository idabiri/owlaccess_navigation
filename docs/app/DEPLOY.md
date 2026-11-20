# Publishing OwlAccess

## Option A: Vercel, static demo (chosen for the hackathon)

**Status: prepared, not deployed.** Connect Vercel to the private GitHub repo; only pushes you make to `main` go live.

| Vercel setting | Value |
|---|---|
| Root Directory | `app` |
| Framework | Vite (from `app/vercel.json`) |
| Install / Build | `npm ci` / `npm run build` |
| Output | `dist` |
| Node.js | 22.x |
| Environment variables | none |

- One static site: no Python, no server, no database. `scripts/` is the offline data pipeline and is not deployed.
- `app/vercel.json` sends every page address (`/plan`, `/navigate`, `/review` ...) to `index.html`, keeps `/api/*` a plain 404,
  and makes browsers re-check `/data/*.json` after an update.
- **Reports on the public site are kept in each visitor's browser only** (built without `VITE_SHARED_REPORTS`): anyone can submit,
  verify, reject and resolve, but other visitors never see those changes, and the app does not call `/api` or poll.
- **The preloaded demo obstacles (OBS-001 to OBS-006) ship with the routing data**, so every visitor sees the same ones. They
  block routes only when verified and only while their demo scenario is on.
- Visitors get the built site only: no source code, no source maps, no dev server, no editing access. Keep the GitHub repo private.
- Local development is unchanged: `npm run dev` still shares reports through the laptop with phones on the same Wi-Fi.

## Option B: Cloudflare, with shared reports (prepared earlier, not used)

When building for this option, set **`VITE_SHARED_REPORTS=true`** in the Cloudflare Pages build settings so the site uses the
shared `/api/reports` service below instead of browser-only reports.


**Status: prepared, not deployed.** Nothing below has been run. Every step that creates an account, a database or a public site
needs your go-ahead; signing in and choosing the passcode are yours to do.

### What gets published

| Part | Where | What it is |
|---|---|---|
| The app | Cloudflare **Pages** (static) | `app/dist/`: the React app plus the synthetic map data in `data/` |
| Shared reports API | Cloudflare **Pages Function** `app/functions/api/[[path]].ts` | `/api/reports` with the **same** validation and verify / reject / resolve rules as the local demo (`server/reportsCore.ts`) |
| Report storage | Cloudflare **D1** (SQLite) | One row holding the reports document; saves are compare-and-swap, so two visitors writing at once lose nothing |
| Reviewer protection | Cloudflare **secret** `REVIEW_PASSCODE` | Verify, reject, resolve and clear need it. Anyone can view the app and submit (pending) reports |

Not published: the local reports file (`app/data/`), the Vite dev server, `/api/network` (laptop addresses), the It design studio,
and the original GIS files. The built site was checked: no server code or secrets in `dist/`. There are no API keys anywhere.

If no passcode is configured, the API **refuses** reviewing and clearing (it fails closed), so a forgotten step cannot open reviewing to everyone.

## Cost and limits

**$0** on Cloudflare's free plan; you need a free Cloudflare account (no paid service is used).

| Limit (free plan) | What it means here |
|---|---|
| Pages Functions / Workers: about 100,000 requests a day | Each open tab asks for changes every 3 s while visible (about 1,200 an hour); hidden tabs ask nothing. Roughly 20 judges for 2 hours fits. Loading the app's pages and data does not count. |
| D1: millions of row reads and 100,000 row writes a day, 5 GB | Far more than a demo needs (each check reads one row, each report or review writes one). |
| If a limit is reached | The API answers with an error until the next day; the map and routing still work, because routing runs in the browser. |

Other limits: anyone with the link can submit pending reports (they never change routes until verified), at most 500 reports are kept, and the
reviewer passcode is shared, not a per-person account. The site says it is a student prototype with synthetic interiors, not an official KSU service.

## Steps (run from `ksu_marietta_integration/app`, only after you approve)

1. Build:
   ```bash
   npm run build
   ```
2. Sign in to Cloudflare (opens your browser; you sign in or create the free account yourself):
   ```bash
   npx wrangler@4 login
   ```
3. Create the database, then paste the `database_id` it prints into `wrangler.toml`:
   ```bash
   npx wrangler@4 d1 create owlaccess-reports
   ```
4. Create the table:
   ```bash
   npx wrangler@4 d1 migrations apply owlaccess-reports --remote
   ```
5. Create the Pages project:
   ```bash
   npx wrangler@4 pages project create owlaccess --production-branch main
   ```
6. Set the reviewer passcode (you type it; it is stored by Cloudflare, not in the code):
   ```bash
   npx wrangler@4 pages secret put REVIEW_PASSCODE --project-name owlaccess
   ```
7. Deploy:
   ```bash
   npx wrangler@4 pages deploy dist --project-name owlaccess
   ```
   It prints the public address, for example `https://owlaccess.pages.dev` (another name is used if that one is taken).

Then check: open the address, calculate a route, submit a report, open `/review`, enter the passcode when asked, and verify it.

## Taking it down

Cloudflare dashboard → Workers & Pages → owlaccess → Settings → Delete, and D1 → owlaccess-reports → Delete.
