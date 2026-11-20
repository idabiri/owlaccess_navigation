// The frame every page shares: header with the site navigation, skip link, page content, and the data-honesty footer.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter } from "./router";
import { design, designStyle } from "../design/design";
import logoUrl from "../assets/owl-logo.svg";

export const NAV_LINKS: { to: string; label: string }[] = [
  { to: "/plan", label: "Plan a route" }, { to: "/navigate", label: "Navigate" }, { to: "/report", label: "Report an issue" },
  { to: "/review", label: "Review" }, { to: "/about", label: "About the data" },
];

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <div className={`site hero-${design.heroLayout} nav-${design.navStyle} cards-${design.cardStyle} plan-${design.planLayout} sugg-${design.suggestionCards} suggmap-${design.suggestionsMap} map-${design.mapContrast}`}
      style={designStyle(design) as React.CSSProperties}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="site-brand" aria-label="OwlAccess home"><img className="site-logo" src={logoUrl} alt="" width={27} height={38} /><span>OwlAccess</span></Link>
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(o => !o)}>
            <span aria-hidden="true">☰</span> Menu</button>
          <nav id="site-nav" aria-label="Main" className={open ? "site-nav open" : "site-nav"}>
            <ul>{NAV_LINKS.map(l => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}</ul>
          </nav>
        </div>
      </header>
      <main id="main" className={wide ? "site-main wide" : "site-main"}>{children}</main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <p><strong>OwlAccess</strong> is a student hackathon prototype for the KSU Marietta campus. It is <strong>not an official Kennesaw State University service</strong>.</p>
          <p>Outdoor paths: OpenStreetMap data prepared in QGIS. Indoor floor plans: <strong>synthetic</strong>. Accessibility information is <strong>not field-verified</strong>. <Link to="/about">How the data works</Link></p>
        </div>
      </footer>
    </div>
  );
}
