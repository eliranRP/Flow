import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar, tabSection } from "./tab-bar";
import { expectRtl, expectTarget } from "./test-support";

function WhereAmI() {
  const location = useLocation();
  return <span data-testid="where">{`${location.pathname}${location.search}`}</span>;
}

function accentRule(): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText !== '.ui-tab-slot[aria-current="page"]') continue;
      return rule.style.getPropertyValue("color").trim();
    }
  }
  return "";
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TabBar", () => {
  it("has four tabs, each a link to its screen (FLOW-364)", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <TabBar />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((link) => link.textContent.trim())).toEqual(["בית", "פרויקטים", "דוחות", "הלוואות"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/projects", "/reports", "/loans"]);
    expectTarget(screen.getByRole("link", { name: "הלוואות" }));
  });

  it("has no add, no badge and no count", () => {
    render(
      <MemoryRouter>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "הוספה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "הוספה" })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-fab")).toBeNull();
    expect(document.querySelector(".ui-count-badge")).toBeNull();
  });

  it("paints the active tab with the accent colour", () => {
    render(
      <MemoryRouter initialEntries={["/projects/villa"]}>
        <TabBar />
      </MemoryRouter>,
    );
    const active = screen.getByRole("link", { name: "פרויקטים" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.matches('.ui-tab-slot[aria-current="page"]')).toBe(true);
    expect(accentRule()).toBe("var(--color-accent-text)");
    expect(screen.getByRole("link", { name: "בית" })).not.toHaveAttribute("aria-current");
  });

  it("marks Home current on settings, and the loans tab on the loans page", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    unmount();
    render(
      <MemoryRouter initialEntries={["/loans/loan-1"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("aria-current", "page");
  });

  it("draws a pill behind the active tab's icon, not only another colour (FLOW-958)", () => {
    let background = "";
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText === '.ui-tab-slot[aria-current="page"] .ui-tab-icon') {
          background = rule.style.getPropertyValue("background-color").trim();
        }
      }
    }
    expect(background).toBe("var(--color-tint-strong)");
    let weight = "";
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText === '.ui-tab-slot[aria-current="page"]') {
          weight = rule.style.getPropertyValue("font-weight").trim() || weight;
        }
      }
    }
    // The label is bold too: a second cue beside the pill and the colour.
    expect(weight).toBe("var(--type-name-weight)");
  });

  it("scrolls to the top when the active tab is tapped", () => {
    const scroll = vi.fn();
    window.scrollTo = scroll;
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <TabBar />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "פרויקטים" }));
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("takes Home on an older month back to this month and the top; on this month it only scrolls", () => {
    const scroll = vi.fn();
    window.scrollTo = scroll;
    for (const [from, to] of [["/?month=2026-03&preview=1", "/?preview=1"], ["/?month=2026-03", "/"]] as const) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[from]}>
          <TabBar />
          <Routes>
            <Route path="*" element={<WhereAmI />} />
          </Routes>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("link", { name: "בית" }));
      expect(screen.getByTestId("where").textContent).toBe(to);
      expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
      unmount();
    }
    scroll.mockClear();
    render(
      <MemoryRouter initialEntries={["/?preview=1"]}>
        <TabBar />
        <Routes>
          <Route path="*" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "בית" }));
    expect(screen.getByTestId("where").textContent).toBe("/?preview=1");
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("goes to the tab's main screen when its tab is tapped from a page inside it", () => {
    const scroll = vi.fn();
    window.scrollTo = scroll;
    for (const [from, name, to] of [["/projects/p-1", "פרויקטים", "/projects"], ["/settings", "בית", "/"], ["/loans/loan-1", "הלוואות", "/loans"], ["/reports/lines", "דוחות", "/reports"]] as const) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[from]}>
          <TabBar />
          <Routes>
            <Route path="*" element={<WhereAmI />} />
          </Routes>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("link", { name }));
      expect(screen.getByTestId("where")).toHaveTextContent(to);
      unmount();
    }
    expect(scroll).not.toHaveBeenCalled();
  });

  it("lights the tab a dev fixture names, where the path names none (FLOW-334)", () => {
    render(
      <MemoryRouter initialEntries={["/e2e/review"]}>
        <TabBar section="home" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
  });

});

describe("tabSection", () => {
  it.each([
    ["/", "home"],
    ["/review", "home"],
    ["/unpaid", "home"],
    ["/profit", "home"],
    ["/cash/2026-06", "home"],
    ["/projects/villa", "projects"],
    ["/projects/villa/profit", "home"],
    ["/projects/villa/profit/2026-06", "home"],
    ["/loans", "loans"],
    ["/loans", "loans"],
    ["/reports", "reports"],
    ["/reports/account", "reports"],
    ["/recurring", "home"],
    ["/missing-bills", "home"],
    ["/settings", "home"],
    ["/settings/categories", "home"],
    ["/add", null],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(tabSection(path)).toBe(expected);
  });
});
