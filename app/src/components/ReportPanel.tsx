import { useMemo, useState } from "react";
import { REPORT_CATEGORIES, MAX_DESCRIPTION, SEVERITY_FOR_REVIEW, type ObstacleReport, type ReportCategory, type ReportDraft, type ConfirmedSeverity, type ReportPlace } from "../reports/obstacleReports";
import { classifyReport, SEVERITIES, type Severity, type Suggestion } from "../reports/classify";

export interface ReportPanelProps {
  reports: ObstacleReport[]; draft: ReportDraft | null; reportMode: boolean; snapError: string | null; storageOk: boolean;
  /** may return a promise; false (or a rejected promise) keeps what was typed so it can be sent again */
  onSubmit: (category: ReportCategory, severity: Severity, description: string, suggestion: Suggestion | undefined) => void | boolean | Promise<boolean>;
  onCancelDraft: () => void; onClearAll: () => void;
  /** which part of the unified side panel this is: the Report tab (compose + your pending reports) or the Reviewer tab */
  section?: "report" | "review";
  routeNotice?: string | null;
  /** Report tab without a floor on screen: offer to open one */
  onOpenFloor?: (floor: number) => void; floors?: number[]; onStartReport?: () => void;
  /** Reviewer tab: jump the map to a report */
  onShowReport?: (r: ObstacleReport) => void;
  /** public deployment: the server asked for the reviewer passcode */
  needsPasscode?: boolean; onPasscode?: (code: string) => void;
  /** Stage 6: reports shared through the laptop's dev server */
  shared?: boolean; syncError?: string | null; reviewerUrls?: string[]; allowClear?: boolean;
  onVerify?: (id: string, category: ReportCategory, severity: ConfirmedSeverity, note: string) => void;
  onReject?: (id: string, note: string) => void; onResolve?: (id: string, note: string) => void;
  /** Stage 7: pick the location from a list (keyboard / screen reader), as an alternative to tapping the plan */
  places?: ReportPlace[]; floorLabel?: string; onChoosePlace?: (edgeId: string) => void;
}

/** The location as a list: every reportable segment of the floor, grouped and named in words. */
function PlacePicker({ places, floorLabel, onChoose }: { places: ReportPlace[]; floorLabel: string; onChoose: (edgeId: string) => void }) {
  const [edge, setEdge] = useState("");
  const groups = [...new Set(places.map(p => p.group))];
  return (
    <form className="place-picker" aria-label="Choose the obstacle location from a list" onSubmit={e => { e.preventDefault(); if (edge) onChoose(edge); }}>
      <label className="field"><span>Or choose the location on {floorLabel} from a list</span>
        <select value={edge} onChange={e => setEdge(e.target.value)}>
          <option value="">Choose a location&hellip;</option>
          {groups.map(g => <optgroup key={g} label={g}>{places.filter(p => p.group === g).map(p => <option key={p.edge_id} value={p.edge_id}>{p.label}</option>)}</optgroup>)}
        </select>
      </label>
      <button type="submit" disabled={!edge}>Use this location</button>
    </form>
  );
}
const BLOCK_EFFECT: Record<ConfirmedSeverity, string> = {
  blocks_everyone: "routes for everyone will avoid it",
  blocks_wheelchair: "wheelchair routes will avoid it; walking routes may still pass",
  minor: "shown on the map only; no route changes",
};

/** The reviewer's decision for one pending report. The reviewer must choose a severity; that choice decides who is rerouted. */
function ReviewForm({ r, onVerify, onReject, onClose }: { r: ObstacleReport; onVerify: ReportPanelProps["onVerify"]; onReject: ReportPanelProps["onReject"]; onClose: () => void }) {
  const start = [r.severity, r.suggestion?.severity].find((s): s is ConfirmedSeverity => !!s && s !== "unclear");
  const [category, setCategory] = useState<ReportCategory>(r.category);
  const [severity, setSeverity] = useState<ConfirmedSeverity | "">(start ?? "");
  const [note, setNote] = useState("");
  return (
    <form className="review-form" aria-label={`Review ${r.report_id}`} onSubmit={e => { e.preventDefault(); if (severity) { onVerify?.(r.report_id, category, severity, note); onClose(); } }}>
      <label className="field"><span>Confirmed problem</span>
        <select value={category} onChange={e => setCategory(e.target.value as ReportCategory)}>
          {Object.entries(REPORT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field"><span>Confirmed severity</span>
        <select value={severity} onChange={e => setSeverity(e.target.value as ConfirmedSeverity)} required>
          <option value="">Choose&hellip;</option>
          {SEVERITY_FOR_REVIEW.map(k => <option key={k} value={k}>{SEVERITIES[k]}</option>)}
        </select>
      </label>
      {severity && <p className="muted">If verified: {BLOCK_EFFECT[severity]}.</p>}
      <label className="field"><span>Reviewer note (optional)</span>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={MAX_DESCRIPTION} placeholder="e.g. Checked on site 10:40" style={{ width: "100%", padding: 6 }} />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={!severity}>Verify obstacle</button>
        <button type="button" onClick={() => { onReject?.(r.report_id, note); onClose(); }}>Reject (not found)</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
const floorName = (f: string) => `Floor ${f.split("_F")[1]}`;
const MIN_TEXT_FOR_SUGGESTION = 6;

/** Obstacle reports in the unified side panel.
 *  section "report": report mode, the location list, the form, and the reports still waiting for review (read-only).
 *  section "review": the reviewer's queue (verify / reject), verified reports (resolve) and closed ones.
 *  Every new report is PENDING and does not affect routes until a reviewer verifies it. */
export function ReportPanel({ reports, draft, reportMode, snapError, storageOk, onSubmit, onCancelDraft, onClearAll, section = "report",
  routeNotice, onVerify, onReject, onResolve, shared = false, syncError = null, reviewerUrls = [], allowClear = true,
  places = [], floorLabel = "this floor", onChoosePlace, onOpenFloor, floors = [], onStartReport, onShowReport, needsPasscode = false, onPasscode }: ReportPanelProps) {
  const [code, setCode] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const pending = reports.filter(r => r.status === "pending"), verified = reports.filter(r => r.status === "verified");
  const closed = reports.filter(r => r.status === "rejected" || r.status === "resolved");
  const header = (r: ObstacleReport) => <><strong>{REPORT_CATEGORIES[r.review?.category ?? r.category]}</strong>
    {(() => { const s = r.review?.severity ?? r.severity; return s && s !== "unclear" ? <> &middot; {SEVERITIES[s]}</> : null; })()} &middot; {floorName(r.floor_id)}, {r.location_label}</>;
  const showOnMap = (r: ObstacleReport) => onShowReport && <button type="button" className="link-btn" onClick={() => onShowReport(r)} aria-label={`Show ${r.report_id} on the map`}>Show on map</button>;
  const pendingItem = (r: ObstacleReport, reviewer: boolean) => (
    <li key={r.report_id}>
      <span className="badge pending">Pending</span> {header(r)}
      <div className="detail">{r.description}</div>
      {r.suggestion && <div className="muted detail">Rule-based suggestion: {REPORT_CATEGORIES[r.suggestion.category]}, {SEVERITIES[r.suggestion.severity]} ({r.suggestion.confidence})
        {" "}&mdash; {r.suggestion_accepted ? "accepted by reporter" : "changed by reporter"}</div>}
      <div className="muted">{new Date(r.created_at).toLocaleString()} &middot; {r.report_id} &middot; not verified, does not affect routes</div>
      {reviewer && (reviewing === r.report_id
        ? <ReviewForm r={r} onVerify={onVerify} onReject={onReject} onClose={() => setReviewing(null)} />
        : <div className="row"><button type="button" onClick={() => setReviewing(r.report_id)}>Review {r.report_id}</button>{showOnMap(r)}</div>)}
    </li>
  );
  const [category, setCategory] = useState<ReportCategory>("blocked_hallway");
  const [severity, setSeverity] = useState<Severity>("unclear");
  const [text, setText] = useState("");
  const suggestion = useMemo(() => (text.trim().length >= MIN_TEXT_FOR_SUGGESTION ? classifyReport(text, draft?.edge_type) : undefined), [text, draft]);
  const matchesSuggestion = !!suggestion && suggestion.category === category && suggestion.severity === severity;
  const reset = () => { setText(""); setCategory("blocked_hallway"); setSeverity("unclear"); };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); if (!text.trim()) return;
    Promise.resolve(onSubmit(category, severity, text, suggestion)).then(ok => { if (ok !== false) reset(); }, () => undefined);
  };
  const syncEl = syncError && <p className="err" role="alert" data-testid="sync-error">{syncError}</p>;

  if (section === "review") return (
    <section className="panel reports" aria-labelledby="review-h">
      <h2 id="review-h">Review obstacle reports</h2>
      <p className="map-note">Check each report, then <strong>verify</strong> it (routes will avoid it, for the people its severity applies to) or <strong>reject</strong> it.
        <span className="muted"> Demo: no sign-in; in real use only trained staff would verify.</span></p>
      {shared && reviewerUrls.length > 0 && <p className="muted" data-testid="reviewer-urls">Review on a phone on the same Wi-Fi: {reviewerUrls.map(u => <code key={u}> {u}</code>)}</p>}
      {routeNotice && <p className="route-notice" role="status">{routeNotice}</p>}
      {syncEl}
      {needsPasscode && onPasscode && (
        <form className="review-form" aria-label="Reviewer passcode" onSubmit={e => { e.preventDefault(); if (code.trim()) { onPasscode(code); setCode(""); } }}>
          <label className="field"><span>Reviewer passcode</span>
            <input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" style={{ width: "100%", padding: 6 }} /></label>
          <p className="muted">Only reviewers can verify, reject or clear reports on the public site. The passcode is kept in this tab only.</p>
          <button type="submit" className="primary" disabled={!code.trim()}>Save passcode</button>
        </form>)}
      <h3>Pending review ({pending.length})</h3>
      {pending.length === 0 ? <p className="muted">No reports waiting for review.</p> : (
        <ul className="report-list" aria-label="Pending obstacle reports">{[...pending].reverse().map(r => pendingItem(r, true))}</ul>)}
      <h3>Verified &ndash; avoided by routes ({verified.length})</h3>
      {verified.length === 0 ? <p className="muted">None.</p> : (
        <ul className="report-list" aria-label="Verified obstacle reports">
          {[...verified].reverse().map(r => (
            <li key={r.report_id}>
              <span className="badge verified">Verified</span> {header(r)}
              <div className="detail">{r.description}</div>
              <div className="muted">Verified by {r.review!.reviewer} {new Date(r.review!.reviewed_at).toLocaleString()}{r.review!.note ? ` · “${r.review!.note}”` : ""} &middot; {BLOCK_EFFECT[r.review!.severity]}</div>
              <div className="row"><button type="button" onClick={() => onResolve?.(r.report_id, "")}>Mark {r.report_id} resolved (obstacle cleared)</button>{showOnMap(r)}</div>
            </li>))}
        </ul>)}
      {closed.length > 0 && <>
        <h3>Closed ({closed.length})</h3>
        <ul className="report-list" aria-label="Closed obstacle reports">
          {[...closed].reverse().map(r => (
            <li key={r.report_id}>
              <span className="badge closed">{r.status === "rejected" ? "Rejected" : "Resolved"}</span> {header(r)}
              <div className="detail">{r.description}</div>
              <div className="muted">{r.report_id} &middot; {r.status === "rejected" ? "rejected by reviewer, never affected routes" : "obstacle cleared, no longer affects routes"}</div>
            </li>))}
        </ul></>}
      {allowClear && reports.length > 0 && <button type="button" onClick={() => { if (window.confirm(`Delete all ${reports.length} demo report(s) ${shared ? "for every device" : "from this browser"}?`)) onClearAll(); }}>Clear demo reports</button>}
      {!shared && !storageOk && <p className="err">This browser is not saving reports (storage blocked), so they will be lost on reload.</p>}
    </section>
  );

  return (
    <section className="panel reports" aria-labelledby="reports-h">
      <h2 id="reports-h">Report an obstacle</h2>
      <p className="map-note">New reports are saved as <strong>pending</strong>. They are shown on the map but <strong>never change a route</strong> until a person verifies them.
        {shared && <> Reports are shared, so a reviewer on another device sees the same list.</>}</p>
      {syncEl}
      {!reportMode && !draft && (floors.length > 0 && onOpenFloor
        ? <div className="row wrap"><span>Reports are placed on a floor. Open one:</span>{floors.map(f => <button key={f} type="button" onClick={() => onOpenFloor(f)}>Floor {f}</button>)}</div>
        : onStartReport && <button type="button" className="primary" onClick={onStartReport}>Start a report on {floorLabel}</button>)}
      {reportMode && !draft && <p className="report-hint" role="status">Tap the spot on the floor plan where the obstacle is{places.length > 0 ? ", or choose it from the list below" : ""}.</p>}
      {reportMode && !draft && places.length > 0 && onChoosePlace && <PlacePicker places={places} floorLabel={floorLabel} onChoose={onChoosePlace} />}
      {snapError && <p className="err" role="alert">{snapError}</p>}
      {draft && (
        <form className="report-form" onSubmit={submit} aria-label="New obstacle report">
          <p id="report-location"><strong>Location:</strong> {floorName(draft.floor_id)}, {draft.location_label}
            <span className="muted">{draft.chosen_from_list ? " (chosen from the list)" : ` (snapped ${draft.snap_distance_m} m from your tap)`}</span></p>
          <label className="field"><span>Describe it</span>
            {/* focus moves here when a location is chosen, so keyboard and screen-reader users land in the form; the location is read with it */}
            <textarea value={text} onChange={e => setText(e.target.value)} maxLength={MAX_DESCRIPTION} rows={3} required autoFocus aria-describedby="report-location"
              placeholder="e.g. Cleaning cart blocking half the corridor next to the elevator" />
          </label>
          {suggestion && (
            <div className={`suggestion conf-${suggestion.confidence}`} role="status" aria-live="polite" aria-label="Suggested classification">
              <div><strong>Suggestion</strong> <span className="muted">(rule-based keyword matching, not AI &mdash; please check it)</span></div>
              <div>{REPORT_CATEGORIES[suggestion.category]} &middot; {SEVERITIES[suggestion.severity]} &middot; <em>{suggestion.confidence} confidence</em></div>
              {suggestion.matched.length > 0 && <div className="muted">Because of: {suggestion.matched.map(m => `“${m}”`).join(", ")}</div>}
              {suggestion.safety_alert && <div className="err"><strong>If anyone is in danger, call 911 first.</strong> A report here is not an emergency call.</div>}
              <button type="button" onClick={() => { setCategory(suggestion.category); setSeverity(suggestion.severity); }} disabled={matchesSuggestion}>
                {matchesSuggestion ? "Suggestion applied" : "Use suggestion"}</button>
            </div>
          )}
          <label className="field"><span>What is the problem?</span>
            <select value={category} onChange={e => setCategory(e.target.value as ReportCategory)}>
              {Object.entries(REPORT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field"><span>How bad is it?</span>
            <select value={severity} onChange={e => setSeverity(e.target.value as Severity)}>
              {Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="row"><button type="submit" className="primary" disabled={!text.trim()}>Submit report</button>
            <button type="button" onClick={() => { reset(); onCancelDraft(); }}>Cancel</button></div>
        </form>
      )}
      <h3>Waiting for review ({pending.length})</h3>
      {pending.length === 0 ? <p className="muted">No reports waiting for review.</p> : (
        <ul className="report-list" aria-label="Pending obstacle reports">{[...pending].reverse().map(r => pendingItem(r, false))}</ul>)}
      {!shared && !storageOk && <p className="err">This browser is not saving reports (storage blocked), so they will be lost on reload.</p>}
    </section>
  );
}
