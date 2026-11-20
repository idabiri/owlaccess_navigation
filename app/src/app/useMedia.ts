import { useEffect, useState } from "react";

/** The phone breakpoint, shared with the CSS (styles.css and pages.css use max-width: 900px for phones). */
export const PHONE_QUERY = "(max-width: 900px)";

const matches = (q: string) => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);

/** true while the screen is phone-sized. Updates when the window is resized or the phone is rotated.
 *  Where matchMedia is missing (old browsers, the jsdom test environment) it reports "not a phone", i.e. the desktop layout. */
export function useIsPhone(query: string = PHONE_QUERY) {
  const [phone, setPhone] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query), on = () => setPhone(mq.matches);
    on(); mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return phone;
}
