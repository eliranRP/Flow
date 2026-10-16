import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar, TabBarPicture, tabSection } from "./tab-bar";
import { expectRtl, expectTarget } from "./test-support";

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
    expect(links.map((link) => link.textContent.trim())).toEqual(["בית", "פרויקטים", "הלוואות", "קבועים"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/projects", "/settings/loans", "/recurring"]);
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

  it("marks no tab current on settings, and the loans tab on the loans page", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
    unmount();
    render(
      <MemoryRouter initialEntries={["/settings/loans/loan-1"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("aria-current", "page");
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

  it("lights the tab a dev fixture names, where the path names none (FLOW-334)", () => {
    render(
      <MemoryRouter initialEntries={["/e2e/review"]}>
        <TabBar section="home" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
  });

  it("draws a picture of the bar with no router or links (FLOW-506)", () => {
    render(<TabBarPicture section="projects" />);
    const bar = document.querySelector(".ui-tabbar-picture");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar?.querySelectorAll(".ui-tab-slot")).toHaveLength(4);
    expect(bar?.querySelector("a, button")).toBeNull();
    expect(bar?.querySelector('[aria-current="page"]')).toHaveTextContent("פרויקטים");
    // Toast placement and the action bar look for .ui-tabbar; a picture must not count as the bar.
    expect(document.querySelector(".ui-tabbar")).toBeNull();
  });
});

describe("tabSection", () => {
  it.each([
    ["/", "home"],
    ["/review", "home"],
    ["/unpaid", "home"],
    ["/flow/expense/category/ILS/c1", "home"],
    ["/profit", "home"],
    ["/cash/2026-06", "home"],
    ["/projects/villa", "projects"],
    ["/settings/loans", "loans"],
    ["/loans", "loans"],
    ["/recurring", "recurring"],
    ["/missing-bills", "recurring"],
    ["/settings", null],
    ["/settings/categories", null],
    ["/add", null],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(tabSection(path)).toBe(expected);
  });
});
