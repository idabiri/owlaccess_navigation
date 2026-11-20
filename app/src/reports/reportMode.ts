// Where obstacle reports and review decisions are kept, decided when the site is built:
//  - local development (`npm run dev`): SHARED through the laptop's dev server (one JSON file; phones on the same Wi-Fi see it);
//  - the public static website (e.g. Vercel): THIS BROWSER ONLY (localStorage). There is no server, so nothing calls /api,
//    nothing polls, and one visitor's reports or decisions are never shown to anyone else.
//  A deployment that does run the reports API (the Cloudflare Pages setup in DEPLOY.md) can turn sharing on at build time
//  with VITE_SHARED_REPORTS=true.
// The preloaded demo obstacles (OBS-001 to OBS-006) are part of the routing data, so they are the same for every visitor
// in both modes.
export interface ReportEnv { DEV?: boolean; VITE_SHARED_REPORTS?: string }
export function sharedReportsEnabled(env: ReportEnv): boolean {
  return env.DEV === true || env.VITE_SHARED_REPORTS === "true";
}
