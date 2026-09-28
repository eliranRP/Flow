import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TabBar } from "./tab-bar";
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

describe("TabBar", () => {
  it("keeps the five slots", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <TabBar reviewCount={7} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const names = [...nav.querySelectorAll("a")].map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(names).toEqual(["בית", "פרויקטים", "הוספה", "לאישור, 7 ממתינים", "הגדרות"]);
    expectTarget(screen.getByRole("link", { name: "הוספה" }));
  });

  it("keeps 99+ in an ltr isolate", () => {
    render(
      <MemoryRouter>
        <TabBar reviewCount={100} />
      </MemoryRouter>,
    );
    const badge = document.querySelector(".ui-count-badge bdi");
    expect(badge).toHaveAttribute("dir", "ltr");
    expect(badge).toHaveTextContent("99+");
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

  it("keeps home active on unpaid and settings active on categories", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/unpaid"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    unmount();
    render(
      <MemoryRouter initialEntries={["/settings/categories"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "הגדרות" })).toHaveAttribute("aria-current", "page");
  });

  it("highlights no tab on add", () => {
    render(
      <MemoryRouter initialEntries={["/add"]}>
        <TabBar />
      </MemoryRouter>,
    );
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });
});
