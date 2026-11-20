import { useEffect, useMemo, useRef, useState } from "react";
import { useIsPhone } from "../app/useMedia";
import { listBuildings } from "../buildings";
import type { AppData } from "../data";
import { route as computeRoute, type RouteResult } from "../routing/unifiedRouting";
import { buildPlan, type NavigationPlan } from "../routing/instructions";
import { OutdoorMap } from "./OutdoorMap";
import { IndoorMap } from "./IndoorMap";
import { NavigationPanel, type NavState } from "./NavigationPanel";
import { RouteResults, RouteSummary } from "./RouteResults";
import { design as defaultDesign, designStyle, type Design } from "../design/design";
import { routeWithStrategy, type Strategy } from "../routing/alternatives";
import { buildSteps } from "../routing/steps";
import logoUrl from "../assets/owl-logo.svg";
import { ReportPanel } from "./ReportPanel";
import { createReport, loadReports, saveReports, snapToEdge, MAX_SNAP_M, blockingObstacles, verifyReport, rejectReport, resolveReport, listReportPlaces, draftFromPlace,
  type ObstacleReport, type ReportCategory, type ReportDraft, type ConfirmedSeverity } from "../reports/obstacleReports";
import type { Severity, Suggestion } from "../reports/classify";
import type { ReportStore, ReviewRequest } from "../reports/reportStore";

type View = { kind: "outdoor" } | { kind: "indoor"; floor: number };
export interface NavigationAppProps {
  data: AppData; initial?: Partial<NavState>;
  /** shared store on the laptop's dev server (Stage 6). Without it, reports live in this browser only (as in the tests). */
  reportStore?: ReportStore;
  /** which side-panel tab opens first ("/review" opens the Reviewer tab) */
  initialPanel?: Panel;
  /** the "Clear demo reports" button (hidden when the app was opened as a reviewer link, e.g. on a phone) */
  allowClear?: boolean;
  /** look and layout (design.json, edited through the It design studio) */
  design?: Design;
  /** inside the multi-page site: the site header replaces this view's own top bar */
  embedded?: boolean;
  /** follow a route alternative chosen on /suggestions (re-run on every recalculation, so verified obstacles still apply) */
  strategy?: Strategy;
  /** calculate the initial start/goal as soon as the view opens */
  autoCalculate?: boolean;
}
export type Panel = "directions" | "report" | "review";
/** which verified reports block, and how: when this changes, the route on screen must be recalculated */
const blockingSignature = (rs: ObstacleReport[]) => rs.filter(r => r.status === "verified").map(r => `${r.report_id}:${r.review?.severity}`).sort().join("|");

export function NavigationApp({ data, initial, reportStore, initialPanel = "directions", allowClear = true, design = defaultDesign, embedded = false, strategy, autoCalculate = false }: NavigationAppProps) {
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [nav, setNav] = useState<NavState>({ start: "", goal: "", mode: "walking", avoidStairs: false, avoidObstacles: true, scenario: "", pick: "goal", ...initial });
  const [result, setResult] = useState<RouteResult | null>(null);
  const [plan, setPlan] = useState<NavigationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seg, setSeg] = useState(0), [ins, setIns] = useState(0), [view, setView] = useState<View>({ kind: "outdoor" });
  const nodes = useMemo(() => new Map(data.unified.nodes.map(n => [n.node_id, n])), [data]);
  const metaById = useMemo(() => new Map(data.unified.endpoints_meta.map(m => [m.id, m])), [data]);
  const labelOf = (id: string) => metaById.get(id)?.label ?? (nodes.has(id) ? `Outdoor path point (${id})` : id);
  const nodeOf = (id: string) => data.unified.endpoints[id] ?? id;
  const viewFor = (p: NavigationPlan, i: number): View => { const s = p.segments[i]; return s.kind === "outdoor" ? { kind: "outdoor" } : { kind: "indoor", floor: s.floor as number }; };
  const patch = (p: Partial<NavState>) => setNav(s => ({ ...s, ...p }));

  // ---- building selector (Stage 5): only BLD001 has an (synthetic) indoor map; the others are outdoor-only ----
  const buildings = useMemo(() => listBuildings(data), [data]);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "BLD001");
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);   // n re-triggers the outdoor zoom on every pick
  const building = buildings.find(b => b.id === buildingId) ?? buildings[0];
  useEffect(() => { if (view.kind === "indoor") setBuildingId(buildings.find(b => b.hasIndoor)?.id ?? buildingId); }, [view]);   // a floor view is always the indoor building
  const chooseBuilding = (id: string) => {
    const b = buildings.find(x => x.id === id); if (!b) return;
    setBuildingId(id);
    if (b.hasIndoor) setView({ kind: "indoor", floor: b.floors[0] });
    else { setView({ kind: "outdoor" }); setFocus(f => ({ id, n: (f?.n ?? 0) + 1 })); }
  };

  // ---- obstacle reports, created as pending. Only reports a reviewer VERIFIED reach the router (see runRoute).
  //      Stored on the laptop's dev server when a reportStore is given (shared with the phone reviewer), else in this browser. ----
  const [reports, setReports] = useState<ObstacleReport[]>(() => (reportStore ? [] : loadReports()));
  const [storageOk, setStorageOk] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reviewerUrls, setReviewerUrls] = useState<string[]>([]);
  const [reportMode, setReportMode] = useState(false);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const updateReports = (list: ObstacleReport[]) => { setReports(list); setStorageOk(saveReports(list)); };
  const segmentOf = useMemo(() => {
    const edges = new Map(data.unified.edges.map(e => [e.edge_id, e]));
    return (id: string): [number, number, number, number] | null => {
      const e = edges.get(id), a = e && nodes.get(e.from_node), b = e && nodes.get(e.to_node);
      return a?.x != null && a.y != null && b?.x != null && b.y != null ? [a.x, a.y, b.x, b.y] : null;
    };
  }, [data, nodes]);
  const toggleReportMode = () => { setReportMode(m => { if (!m) setPanel("report"); return !m; }); setDraft(null); setSnapError(null); };
  const reportPoint = (floorId: string, x: number, y: number) => {
    const d = snapToEdge(data.unified, floorId, x, y); setPanel("report");
    if (d) { setDraft(d); setSnapError(null); } else { setDraft(null); setSnapError(`That spot is more than ${MAX_SNAP_M} m from any hallway, doorway or elevator. Tap closer to a walkway.`); }
  };
  const viewFloorId = view.kind === "indoor" ? `BLD001_F${view.floor}` : null;
  const places = useMemo(() => (viewFloorId ? listReportPlaces(data.unified, viewFloorId) : []), [data, viewFloorId]);
  const choosePlace = (edgeId: string) => {
    const d = viewFloorId ? draftFromPlace(data.unified, viewFloorId, edgeId) : null;
    if (d) { setDraft(d); setSnapError(null); } else setSnapError("That location could not be found on this floor.");
  };
  const [needsPasscode, setNeedsPasscode] = useState(false);              // public deployment: reviewing needs the reviewer passcode
  const failSync = (e: unknown) => {
    setSyncError(e instanceof Error ? e.message : String(e));
    if ((e as { needsPasscode?: boolean })?.needsPasscode) { setNeedsPasscode(true); setPanel("review"); }
  };
  const savePasscode = (code: string) => { reportStore?.setReviewerPasscode?.(code); setNeedsPasscode(false); setSyncError(null); setRouteNotice("Reviewer passcode saved for this tab. Repeat the review to apply it."); };
  const submitReport = (category: ReportCategory, severity: Severity, description: string, suggestion: Suggestion | undefined): boolean | Promise<boolean> => {
    if (!draft) return false;
    const report = createReport(draft, category, description, { severity, suggestion });
    if (!reportStore) { updateReports([...reports, report]); setDraft(null); setReportMode(false); return true; }
    return reportStore.add(report)
      .then(s => { setReports(s.reports); reportsRef.current = s.reports; setSyncError(null); setDraft(null); setReportMode(false); return true; })
      .catch(e => { failSync(e); return false; });                                   // the draft and the typed text are kept
  };

  // ---- routing. The router is unchanged: verified reports are added as extra obstacles and selected by id, and the
  //      router's own rule (status "verified" && verified) still decides. Severity decides which modes get them. ----
  const [lastQuery, setLastQuery] = useState<NavState | null>(null);       // the settings of the route on screen, for recalculation
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const runRoute = (q: NavState, reps: ObstacleReport[]): RouteResult => {
    const wheelchair = q.mode === "wheelchair", extra = blockingObstacles(reps, wheelchair);
    if (strategy && q.start === initial?.start && q.goal === initial?.goal && q.mode === (initial?.mode ?? "walking"))   // the alternative chosen on /suggestions, for that same trip
      return routeWithStrategy(data.unified, q.start, q.goal, { wheelchair, avoidStairs: q.avoidStairs, applyObstacles: q.avoidObstacles, scenario: q.scenario || undefined, extraObstacles: extra }, strategy);
    return computeRoute({ ...data.unified, obstacles: [...data.unified.obstacles, ...extra] }, q.start, q.goal,
      { wheelchair, avoidStairs: q.avoidStairs, scenario: q.scenario || undefined, applyObstacles: q.avoidObstacles, obstacleIds: extra.map(o => o.obstacle_id) });
  };
  const show = (q: NavState, r: RouteResult, moveView: boolean) => {
    setResult(r);
    if (r.found) { const p = buildPlan(data.unified, r, labelOf(q.start), labelOf(q.goal)); setPlan(p); setSeg(0); setIns(0); if (moveView) setView(viewFor(p, 0)); } else setPlan(null);
  };
  const [reportsLoaded, setReportsLoaded] = useState(!reportStore);
  const [plannerOpen, setPlannerOpen] = useState(true);
  const calculate = () => {
    setError(null); setRouteNotice(null);
    try { const r = runRoute(nav, reports); show(nav, r, true); setLastQuery(nav); if (r.found) { setPlannerOpen(false); setPanel("directions"); } }
    catch (e) { setResult(null); setPlan(null); setLastQuery(null); setError(e instanceof Error ? e.message : String(e)); }
  };
  // opened from /suggestions: calculate the planned trip once the shared reports are in (so verified obstacles count)
  const autoDone = useRef(false);
  useEffect(() => { if (autoCalculate && reportsLoaded && !autoDone.current && nav.start && nav.goal) { autoDone.current = true; calculate(); } }, [autoCalculate, reportsLoaded]);
  const summary = (r: RouteResult) => (r.found ? `${r.distanceM.toFixed(1)} m / ${Math.round(r.travelTimeS)} s` : r.reason);
  // refs, so that a change arriving from another device recalculates with the route that is on screen now
  const lastQueryRef = useRef(lastQuery), resultRef = useRef(result), reportsRef = useRef(reports);
  useEffect(() => { lastQueryRef.current = lastQuery; resultRef.current = result; reportsRef.current = reports; });
  /** what blocks has changed: recalculate the route on screen and say what changed */
  const recalc = (list: ObstacleReport[], reason: string) => {
    const q = lastQueryRef.current, prev = resultRef.current;
    if (!q || !prev) { setRouteNotice(null); return; }
    try {
      const next = runRoute(q, list), before = summary(prev), after = summary(next);
      const same = prev.found && next.found ? prev.links.join() === next.links.join() : prev.found === next.found;
      show(q, next, false); resultRef.current = next;
      setRouteNotice(same ? `Route rechecked after ${reason}: no change (${after}).`
        : !next.found ? `Route recalculated after ${reason}: no route now (${after}).`
        : !prev.found ? `Route recalculated after ${reason}: a route is available again (${after}).`
        : `Route recalculated after ${reason}: ${before} → ${after}.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  /** a reviewer decision, applied with the shared verify / reject / resolve rules (on the server when there is a store) */
  const review = (id: string, request: ReviewRequest, verb: string) => {
    const reason = `${id} was ${verb}`;
    if (!reportStore) {
      const change = (r: ObstacleReport) => request.action === "verify" ? verifyReport(r, request.category, request.severity, request.note)
        : request.action === "reject" ? rejectReport(r, request.note) : resolveReport(r, request.note);
      const list = reports.map(r => (r.report_id === id ? change(r) : r));
      updateReports(list); reportsRef.current = list; recalc(list, reason); if (!lastQueryRef.current) setRouteNotice(`${id} ${verb}. New routes take this into account.`); return;
    }
    reportStore.review(id, request)
      .then(s => { setReports(s.reports); reportsRef.current = s.reports; setSyncError(null); recalc(s.reports, reason); if (!lastQueryRef.current) setRouteNotice(`${id} ${verb}. New routes take this into account.`); })
      .catch(e => { failSync(e); reportStore.load().then(s => setReports(s.reports)).catch(() => undefined); });   // e.g. already reviewed on the phone: show the latest
  };
  const onVerify = (id: string, category: ReportCategory, severity: ConfirmedSeverity, note: string) => review(id, { action: "verify", category, severity, note }, "verified");
  const onReject = (id: string, note: string) => review(id, { action: "reject", note }, "rejected");
  const onResolve = (id: string, note: string) => review(id, { action: "resolve", note }, "marked resolved");
  const clearAll = () => {
    const had = reports.some(r => r.status === "verified"), done = (list: ObstacleReport[]) => { setDraft(null); reportsRef.current = list; if (had) recalc(list, "the demo reports were cleared"); };
    if (!reportStore) { updateReports([]); done([]); return; }
    reportStore.clear().then(s => { setReports(s.reports); setSyncError(null); done(s.reports); }).catch(failSync);
  };
  // shared store: load once, then follow changes made on any device (e.g. the phone reviewer)
  useEffect(() => {
    if (!reportStore) return;
    let live = true;
    reportStore.load().then(s => { if (live) { setReports(s.reports); reportsRef.current = s.reports; setSyncError(null); setReportsLoaded(true); } })
      .catch(e => { if (live) { failSync(e); setReportsLoaded(true); } });
    reportStore.reviewerUrls().then(u => live && setReviewerUrls(u));
    const stop = reportStore.watch(s => {
      if (!live) return;
      const changed = blockingSignature(s.reports) !== blockingSignature(reportsRef.current);
      setReports(s.reports); reportsRef.current = s.reports; setSyncError(null);
      if (changed) recalc(s.reports, "a review on another device");
    }, msg => live && setSyncError(msg));
    return () => { live = false; stop(); };
  }, [reportStore]);
  // ---- unified layout helpers ----
  const [focusReportId, setFocusReportId] = useState<string | null>(null);
  const showReport = (r: ObstacleReport) => { setView({ kind: "indoor", floor: Number(r.floor_id.split("_F")[1]) }); setFocusReportId(r.report_id); };
  const openFloor = (f: number) => setView({ kind: "indoor", floor: f });
  const startReport = () => { setPanel("report"); if (!reportMode) toggleReportMode(); };
  const reportCounts = useMemo(() => {
    const c: Record<string, { pending: number; verified: number }> = {};
    for (const r of reports) {
      if (r.status !== "pending" && r.status !== "verified") continue;
      const b = r.floor_id.split("_F")[0], e = (c[b] ??= { pending: 0, verified: 0 });
      if (r.status === "pending") e.pending++; else e.verified++;
    }
    return c;
  }, [reports]);
  const pendingCount = reports.filter(r => r.status === "pending").length;
  /** inside the site, following a route chosen on /suggestions: planning already happened, so planning controls step aside */
  const following = embedded && !!strategy;
  /** inside the site, the Report and Review tabs are about reports, not trips: route planning steps aside until Directions is chosen */
  const planningUi = !following && !(embedded && panel !== "directions");
  const phone = useIsPhone();
  /** on phones the tabs sit in a bar at the bottom of the screen, below the map: a tap also brings the panel into view */
  const choosePanel = (p: Panel) => {
    setPanel(p);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches)
      requestAnimationFrame(() => document.querySelector(".panel-body")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const goSegment = (i: number) => { if (!plan) return; const k = Math.max(0, Math.min(plan.segments.length - 1, i)); setSeg(k); setView(viewFor(plan, k)); const j = plan.instructions.findIndex(x => x.segmentIndex === k); if (j >= 0) setIns(j); };
  /** select a step: the list, the strip, the highlighted segment, the (simulated) position and the floor shown all follow it */
  const goInstruction = (i: number) => {
    if (!plan) return; const j = Math.max(0, Math.min(plan.instructions.length - 1, i));
    setIns(j); const k = plan.instructions[j].segmentIndex; setSeg(k); setView(viewFor(plan, k));
  };
  const found = result && result.found ? result : null;
  const steps = useMemo(() => (found && plan ? buildSteps(data.unified, found, plan) : []), [found, plan, data]);
  const curStep = steps[ins];
  const activeNodes = curStep ? curStep.nodeIds : plan ? plan.segments[seg]?.nodeIds : undefined;
  const scen = data.unified.scenarios.find(s => s.scenario_id === nav.scenario);
  const activeObstacles = nav.avoidObstacles && scen ? scen.obstacle_ids : [];
  const roomOf = (id: string) => (/^room_\d{3}$/.test(id) ? id : null);
  const pickNode = (id: string) => patch(nav.pick === "start" ? { start: id } : { goal: id });
  const routeFloors = found ? found.floors.map(f => Number(f.split("_F")[1])) : [];
  const mapTitle = view.kind === "outdoor" ? "Outdoor map" : `Indoor map – floor ${view.floor}`;
  const indoorFloors = buildings.find(b => b.hasIndoor)?.floors ?? [];
  const sync = !reportStore ? { cls: "local", text: "Reports: this browser only" } : syncError ? { cls: "off", text: "Reports: not syncing" } : { cls: "live", text: "Reports: live, shared" };
  /** phones, Directions panel, with a route: a dock above the bottom tab bar keeps the current step and Previous/Next under the thumb */
  const dock = phone && panel === "directions" && !!curStep;
  // phones: when a new route opens in the dock, scroll so the route summary sits at the top and the map fills the screen above the dock
  const dockRoute = dock && found ? found.nodes.join(">") : "";
  useEffect(() => {
    if (!dockRoute) return;
    const t = setTimeout(() => { const el = document.querySelector(".app .route-strip") as HTMLElement | null; el?.scrollIntoView?.({ block: "start" }); }, 60);
    return () => clearTimeout(t);
  }, [dockRoute]);
  const tabs: { id: Panel; label: string }[] = [
    { id: "directions", label: "Directions" }, { id: "report", label: "Report" }, { id: "review", label: `Reviewer (${pendingCount})` },
  ];

  const sidePanel = (
    <aside className="side" aria-label="Route planner, reports and review">
      {/* once a route is on screen the planner folds into one line, so the directions sit at the top of the panel */}
      {planningUi && <details className="planner" open={plannerOpen} onToggle={e => setPlannerOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>{found && lastQuery
          ? <><b>Route planner</b> <span className="muted">{labelOf(lastQuery.start)} → {labelOf(lastQuery.goal)} · {lastQuery.mode === "wheelchair" ? "Wheelchair" : "Walking"} · change</span></>
          : <b>Route planner</b>}</summary>
        <NavigationPanel state={nav} endpoints={data.unified.endpoints_meta} scenarios={data.unified.scenarios} labelOf={labelOf} onChange={patch} onCalculate={calculate} />
      </details>}
      <div className="panel-tabs" role="tablist" aria-label="Panels">
        {tabs.map(t => <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={panel === t.id}
          className={panel === t.id ? "ptab on" : "ptab"} onClick={() => choosePanel(t.id)}>{t.label}</button>)}
      </div>
      <div role="tabpanel" id={`panel-${panel}`} aria-labelledby={`tab-${panel}`} className="panel-body">
        {panel === "directions" && (found
          ? <RouteResults result={result} plan={plan} activeInstruction={ins} onInstruction={goInstruction} steps={steps} mode={nav.mode} />
          : <section className="panel"><h2>Directions</h2><p className="muted">{result && !result.found ? "No route to give directions for. See the message above the map." : "Calculate a route to see turn-by-turn directions here."}</p></section>)}
        {(panel === "report" || panel === "review") && (
          <ReportPanel section={panel} reports={reports} draft={draft} reportMode={reportMode} snapError={snapError} storageOk={storageOk}
            onSubmit={submitReport} onCancelDraft={() => { setDraft(null); setSnapError(null); }}
            places={places} floorLabel={view.kind === "indoor" ? `Floor ${view.floor}` : "this floor"} onChoosePlace={choosePlace}
            floors={view.kind === "outdoor" ? indoorFloors : []} onOpenFloor={f => { openFloor(f); setReportMode(true); }} onStartReport={startReport}
            onClearAll={clearAll} allowClear={allowClear} syncError={syncError} shared={!!reportStore} reviewerUrls={reviewerUrls}
            onVerify={onVerify} onReject={onReject} onResolve={onResolve} routeNotice={routeNotice} onShowReport={showReport}
            needsPasscode={needsPasscode} onPasscode={savePasscode} />)}
      </div>
    </aside>
  );

  return (
    <div className={`app panel-${design.panelSide} density-${design.density} map-${design.mapContrast} cards-${design.reportCards}${dock ? " has-dock" : ""}`} style={designStyle(design) as React.CSSProperties}>
      {!embedded && <header className="topbar">
        <div className="brand"><img className="logo" src={logoUrl} alt="" width={20} height={28} /><span className="name">OwlAccess</span>
          <span className="sub">KSU Marietta accessible navigation &middot; student prototype</span></div>
        <span className={`sync ${sync.cls}`} role="status">{sync.text}</span>
      </header>}
      <div className="banner" role="note">{embedded && <span className={`sync ${sync.cls} inline`}>{sync.text}</span>} <strong>Prototype, not an official KSU service.</strong> Indoor floor plans are <strong>synthetic</strong>; entrance locations and accessibility details are <strong>not field-checked</strong>. <a href="/about">What&rsquo;s real?</a></div>
      <div className="workspace">
        {sidePanel}
        <main className="stage" aria-label="Campus map">
          <div className="stage-bar">
            {planningUi && <label className="building-select"><span>Building</span>
              <select value={building?.id} onChange={e => chooseBuilding(e.target.value)} aria-label="Building">
                {buildings.map(b => <option key={b.id} value={b.id}>{b.shortName} &mdash; {b.hasIndoor ? `${b.floors.length} floors (synthetic indoor map)` : "outdoor only"}</option>)}
              </select>
            </label>}
            {building && !building.hasIndoor && <span className="badge closed">No indoor map</span>}
            <div role="tablist" aria-label="Map view" className="view-tabs">
              <button type="button" role="tab" aria-selected={view.kind === "outdoor"} className={view.kind === "outdoor" ? "tab on" : "tab"} onClick={() => setView({ kind: "outdoor" })}>Outdoor</button>
              {building?.hasIndoor && building.floors.map(f => <button key={f} type="button" role="tab" aria-selected={view.kind === "indoor" && view.floor === f} className={view.kind === "indoor" && view.floor === f ? "tab on" : "tab"} onClick={() => setView({ kind: "indoor", floor: f })}>Floor {f}{routeFloors.includes(f) ? " •" : ""}</button>)}
            </div>
            <h2 data-testid="map-title">{mapTitle}</h2>
          </div>
          {/* on phones the current step and Previous/Next move to the dock at the bottom of the screen */}
          {(result || error || planningUi) && <RouteSummary result={result} plan={plan} error={error} mode={nav.mode} activeSegment={seg} onSegment={goSegment} notice={routeNotice}
            steps={steps} activeStep={ins} onStep={dock ? undefined : goInstruction} />}
          {building && !building.hasIndoor && view.kind === "outdoor" && (
            <p className="building-note" role="status" data-testid="building-note"><strong>{building.name}</strong> has no indoor map yet. Only its outline and the outdoor paths around it are shown;
              its entrances in the source data are not yet connected to the routing network, so routes cannot go inside it.</p>)}
          {view.kind === "outdoor"
            ? <OutdoorMap data={data} route={found} activeNodeIds={found ? activeNodes : undefined} startNode={nav.start ? nodeOf(nav.start) : null} goalNode={nav.goal ? nodeOf(nav.goal) : null} pickMode={planningUi ? nav.pick : null} onPickNode={planningUi ? pickNode : undefined}
                focusBuildingId={building?.id ?? null} focusRequest={focus} reportCounts={reportCounts}
                positionNodeId={curStep?.positionNodeId ?? null} focusNodeIds={curStep?.nodeIds} />
            : <IndoorMap floor={view.floor} svgText={data.svgs[view.floor]} nodes={nodes} routeNodeIds={found?.nodes} startRoomId={roomOf(nav.start)} goalRoomId={roomOf(nav.goal)} activeObstacleIds={activeObstacles}
                onSelectRoom={!planningUi ? undefined : id => patch(nav.pick === "start" ? { start: id } : { goal: id })}
                reportMode={reportMode} onToggleReportMode={toggleReportMode} onReportPoint={reportPoint} reports={reports} draft={draft} segmentOf={segmentOf} focusReportId={focusReportId}
                activeStepNodeIds={curStep?.nodeIds} positionNodeId={curStep?.positionNodeId ?? null}
                endpointNodeIds={found ? { start: found.nodes[0], goal: found.nodes[found.nodes.length - 1] } : undefined}
                floorCount={Object.keys(data.svgs).length} />}
        </main>
      </div>
      {dock && curStep && (
        <div className="step-dock" role="region" aria-label="Current step" aria-live="polite">
          <button type="button" className="icon-btn" onClick={() => goInstruction(ins - 1)} disabled={ins <= 0} aria-label="Previous step">‹</button>
          <div className="dock-text">
            <p className="dock-meta">Step {ins + 1} of {steps.length} &middot; {curStep.place} &middot; <span className="sim-tag">position simulated</span></p>
            <p className="dock-ins" data-testid="dock-step">{curStep.ins.text}</p>
            <button type="button" className="link-btn" onClick={() => document.querySelector(".nav-steps")?.scrollIntoView({ block: "start", behavior: "smooth" })}>All steps</button>
          </div>
          <button type="button" className="icon-btn next" onClick={() => goInstruction(ins + 1)} disabled={ins >= steps.length - 1} aria-label="Next step">›</button>
        </div>)}
    </div>
  );
}
