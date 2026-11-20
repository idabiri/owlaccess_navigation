// SOS: the header button is on every main page, opens the emergency screen, closes again, and links to the right numbers.
// The tel: links are only inspected, never clicked, so no call is ever attempted (jsdom cannot place calls anyway).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteForTests } from "../src/App";
import { EMPTY_TRIP } from "../src/app/AppState";
import { loadFixtureData } from "./helpers";

const data = loadFixtureData();
const go = (path: string) => window.history.replaceState(null, "", path);
beforeEach(() => { cleanup(); go("/"); });
const sos = () => screen.getByRole("button", { name: /^sos/i });

describe("SOS emergency screen", () => {
  it.each(["/", "/plan", "/suggestions", "/navigate", "/report", "/review", "/about"])("the SOS button is on %s", path => {
    go(path); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    expect(sos()).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();          // closed until asked for
  });

  it("opens with both numbers as tel: links, and says nothing about anyone being notified", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    await user.click(sos());
    const dialog = screen.getByRole("dialog", { name: "Emergency help" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("link", { name: /call 911/i })).toHaveAttribute("href", "tel:911");
    const police = within(dialog).getByRole("link", { name: /call ksu campus police/i });
    expect(police).toHaveAttribute("href", "tel:+14705786666");
    expect(police).toHaveTextContent("470-578-6666");
    expect(dialog).toHaveTextContent(/in an immediate emergency, call 911/i);
    expect(dialog).not.toHaveTextContent(/(have been|has been|was) (notified|called|placed|sent)|help is on the way|calling\.\.\./i);
    expect(screen.getByRole("heading", { name: "Emergency help" })).toHaveFocus();   // not a call button, so Enter cannot dial
  });

  it("closes with the close button, the back button, or Escape, and returns focus to SOS", async () => {
    const user = userEvent.setup();
    go("/plan"); render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    for (const how of ["x", "back", "escape"] as const) {
      await user.click(sos());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      if (how === "x") await user.click(screen.getByRole("button", { name: "Close emergency help" }));
      else if (how === "back") await user.click(screen.getByRole("button", { name: /back to owlaccess/i }));
      else await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(sos()).toHaveFocus();
      expect(window.location.pathname).toBe("/plan");           // still on the page you came from
    }
  });

  it("keeps keyboard focus inside the emergency screen", async () => {
    const user = userEvent.setup();
    render(<SiteForTests data={data} trip={EMPTY_TRIP} />);
    await user.click(sos());
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) { await user.tab(); expect(dialog).toContainElement(document.activeElement as HTMLElement); }
    for (let i = 0; i < 8; i++) { await user.tab({ shift: true }); expect(dialog).toContainElement(document.activeElement as HTMLElement); }
  });
});
