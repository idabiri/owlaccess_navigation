// A small URL router for OwlAccess (no extra package): real addresses, Back/Forward, deep links.
// The dev server and static hosts (Cloudflare Pages) send every unknown path to index.html, so /plan etc. open directly.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

export const PAGES = ["/", "/plan", "/suggestions", "/navigate", "/report", "/review", "/about"] as const;
export type PagePath = (typeof PAGES)[number];

interface RouterValue { path: string; navigate: (to: string, opts?: { replace?: boolean }) => void }
const RouterCtx = createContext<RouterValue>({ path: "/", navigate: () => undefined });

const clean = (p: string) => (p.replace(/\/+$/, "") || "/");

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => clean(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(clean(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    if (opts.replace) window.history.replaceState(null, "", url.pathname + url.search);
    else window.history.pushState(null, "", url.pathname + url.search);
    setPath(clean(url.pathname));
    if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo({ top: 0 });          // the test environment has no scrolling
  }, []);
  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  // move keyboard and screen-reader focus to the new page's main heading after a page change
  useEffect(() => { const h = document.querySelector<HTMLElement>("main h1"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }, [path]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

/** An ordinary link that changes page without reloading; modified clicks (new tab etc.) behave as usual. */
export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { path, navigate } = useRouter();
  const current = clean(new URL(to, "http://x").pathname) === path;
  return (
    <a href={to} aria-current={current ? "page" : undefined} {...rest}
      onClick={e => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); navigate(to);
      }}>{children}</a>
  );
}
