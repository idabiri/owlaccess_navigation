// SOS: an emergency-help button in the site header (so it is on every page and never covers the map) and the screen it opens.
// Deliberately simple: two tel: links that open the device's own dialer. No location, no dispatch, no forms, no network.
// Nothing here claims anyone has been notified: a call only happens if the person places it themselves.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const EMERGENCY_NUMBERS = {
  emergency: { label: "Call 911", display: "911", tel: "tel:911" },
  campusPolice: { label: "Call KSU Campus Police", display: "470-578-6666", tel: "tel:+14705786666" },
} as const;

export function SosButton() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="sos-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        aria-label="SOS: emergency phone numbers">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor"
          d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg>
        <span>SOS</span>
      </button>
      {open && createPortal(<SosDialog onClose={close} />, document.body)}
    </>
  );
}

function SosDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();                        // start on the heading, so a stray Enter cannot open the dialer
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !box.current) return;   // keep keyboard focus inside the emergency screen
    const items = [...box.current.querySelectorAll<HTMLElement>("a[href], button")];
    const first = items[0], last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === title.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  const { emergency: e911, campusPolice: police } = EMERGENCY_NUMBERS;
  return (
    <div className="sos-overlay" onMouseDown={ev => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div ref={box} className="sos-dialog" role="dialog" aria-modal="true" aria-labelledby="sos-title" aria-describedby="sos-lead" onKeyDown={onKeyDown}>
        <div className="sos-top">
          <h2 id="sos-title" ref={title} tabIndex={-1}>Emergency help</h2>
          <button type="button" className="sos-x" onClick={onClose} aria-label="Close emergency help">
            <span aria-hidden="true">×</span></button>
        </div>
        <p id="sos-lead" className="sos-lead"><strong>In an immediate emergency, call 911.</strong> For other safety concerns on campus, call KSU Campus Police.</p>
        <div className="sos-calls">
          <a className="sos-call is-911" href={e911.tel}>
            <span className="sos-call-label">{e911.label}</span>
            <span className="sos-call-sub">Police, fire, medical</span>
          </a>
          <a className="sos-call is-police" href={police.tel}>
            <span className="sos-call-label">{police.label}</span>
            <span className="sos-call-sub">{police.display}</span>
          </a>
        </div>
        <p className="sos-note">Tapping a button opens your phone's dialer.</p>
        <button type="button" className="sos-back" onClick={onClose}>‹ Back to OwlAccess</button>
      </div>
    </div>
  );
}
