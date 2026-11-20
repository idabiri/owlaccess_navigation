import { useEffect, useMemo, useState } from "react";
import { loadAppData, type AppData } from "./data";
import { httpReportStore, type ReportStore } from "./reports/reportStore";
import { Router, useRouter } from "./app/router";
import { AppStateProvider, type TripPlan } from "./app/AppState";
import { Shell } from "./app/Shell";
import { LandingPage } from "./pages/LandingPage";
import { PlanPage } from "./pages/PlanPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import { NavigatePage, ReportPage, ReviewPage } from "./pages/MapPages";
import { AboutPage, NotFoundPage } from "./pages/AboutPage";
import "./pages.css";

/** OwlAccess: one app, one data load, one shared report store, many pages. */
export function App() {
  const store = useMemo(() => httpReportStore(), []);
  const [data, setData] = useState<AppData | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAppData().then(setData).catch(e => setErr(String(e))); }, []);
  return (
    <Router>
      {err ? <Shell><div className="page"><h1>Couldn't load the map data</h1><p role="alert">{err}</p></div></Shell>
        : !data ? <Shell><div className="page loading" role="status" aria-live="polite"><div><p>Loading the campus map&hellip;</p><div className="ld-line" aria-hidden="true" /></div></div></Shell>
        : <AppStateProvider data={data} store={store}><Pages /></AppStateProvider>}
    </Router>
  );
}

/** the page for the current address (exported for tests, which wrap it in Router and AppStateProvider) */
export function Pages() {
  const { path } = useRouter();
  const page = path === "/" ? <LandingPage /> : path === "/plan" ? <PlanPage /> : path === "/suggestions" ? <SuggestionsPage />
    : path === "/navigate" ? <NavigatePage /> : path === "/report" ? <ReportPage /> : path === "/review" ? <ReviewPage />
    : path === "/about" ? <AboutPage /> : <NotFoundPage />;
  return <Shell wide={["/navigate", "/report", "/review", "/suggestions"].includes(path)}>{page}</Shell>;
}

/** test helper: the whole site with given data, store and trip */
export function SiteForTests({ data, store, trip }: { data: AppData; store?: ReportStore; trip?: TripPlan }) {
  return <Router><AppStateProvider data={data} store={store} initialTrip={trip}><Pages /></AppStateProvider></Router>;
}
