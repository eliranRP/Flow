import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenHeader } from "./screen-header";
import { expectRtl, expectTarget } from "./test-support";

describe("ScreenHeader", () => {
  it("titles a screen, and the back control is 44px", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <>
          <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." />
          <ScreenHeader title="פרויקטים" backTo="/" />
        </>
      </MemoryRouter>,
    );
    const title = screen.getByRole("heading", { name: "עזרה" });
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveClass("ui-focus-title");
    expectTarget(screen.getByRole("button", { name: "חזרה" }));
  });

  it("stacks the title under the bar", () => {
    render(
      <MemoryRouter>
        <ScreenHeader
          layout="stacked"
          title="פיצול בין פרויקטים"
          subtitle="מלט"
          subtitleClassName="ui-split-context"
        />
      </MemoryRouter>,
    );
    const title = screen.getByRole("heading", { name: "פיצול בין פרויקטים" });
    expect(title).toHaveClass("t-title-1");
    expect(title.closest("header")).toHaveClass("ui-page-stacked");
    expect(screen.getByText("מלט")).toHaveClass("ui-split-context");
    expect(screen.getByText("מלט")).toHaveClass("text-text-secondary");
  });

  it("puts a title with Back on its own line, on the start side, under the bar (FLOW-326)", () => {
    const { container } = render(
      <MemoryRouter>
        <ScreenHeader title="קטגוריות" kicker="הגדרות" subtitle="שורה" backTo="/settings" />
      </MemoryRouter>,
    );
    const header = container.querySelector("header");
    expect(header).toHaveClass("ui-page-stacked");
    const bar = header?.querySelector(".ui-page-title-row");
    // FLOW-334 H2: the kicker is Back's label now, "‹ הגדרות".
    const back = screen.getByRole("button", { name: "חזרה להגדרות" });
    const title = screen.getByRole("heading", { name: "קטגוריות" });
    expect(bar).toContainElement(back);
    expect(back).toHaveTextContent("הגדרות");
    expect(bar).not.toContainElement(title);
    expect(header?.querySelector("p.t-hint")).toBeNull();
    const order = Array.from(header?.children ?? []).map((node) => node.textContent);
    expect(order).toEqual(["הגדרות", "קטגוריות", "", "שורה"]);
  });

  it("keeps the icon Back when there is no kicker, and never labels a leading control", () => {
    render(
      <MemoryRouter>
        <>
          <ScreenHeader title="שויכו היום" backTo="/review" />
          <ScreenHeader title="הוצאה" kicker="פרויקט" leading={<button type="button">סגירה</button>} />
        </>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "חזרה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^חזרה ל/ })).not.toBeInTheDocument();
    expect(screen.getByText("פרויקט")).toHaveClass("t-hint");
  });

  it("keeps a tab root, a compact bar, and an explicit inline title on the bar", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ScreenHeader title="הגדרות" />
          <ScreenHeader title="הוצאה" size="compact" leading={<button type="button">חזרה</button>} />
          <ScreenHeader title="לאישור" layout="inline" backTo="/" />
        </>
      </MemoryRouter>,
    );
    const headers = Array.from(container.querySelectorAll("header"));
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      expect(header).not.toHaveClass("ui-page-stacked");
      expect(header.querySelector(".ui-page-title-row h1")).not.toBeNull();
    }
  });

  describe("compact bar (FLOW-334 H1)", () => {
    let report: ((entry: Partial<IntersectionObserverEntry>) => void) | null = null;
    function observe() {
      vi.stubGlobal("IntersectionObserver", class {
        constructor(callback: IntersectionObserverCallback) {
          report = (entry) => { callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver); };
        }
        observe() {}
        disconnect() {}
      });
    }
    afterEach(() => {
      vi.unstubAllGlobals();
      report = null;
    });

    function scrolled(past: boolean) {
      act(() => {
        report?.({ isIntersecting: !past, boundingClientRect: { top: past ? -20 : 120 } as DOMRectReadOnly });
      });
    }

    it("shows Back and a small title once the large title scrolls off, and hides them again", () => {
      observe();
      const { container } = render(
        <MemoryRouter initialEntries={["/review", "/review/filed"]} initialIndex={1}>
          <Routes>
            <Route path="/review" element={<p>הרשימה</p>} />
            <Route path="/review/filed" element={<ScreenHeader title="שויכו היום" backTo="/review" />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(container.querySelector(".ui-compact-bar")).toBeNull();
      scrolled(true);
      const bar = container.querySelector(".ui-compact-bar");
      expect(bar).not.toBeNull();
      expect(bar).toHaveTextContent("שויכו היום");
      expect(document.documentElement).toHaveAttribute("data-compact-bar");
      // The page's h1 is still the only heading.
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      scrolled(false);
      expect(container.querySelector(".ui-compact-bar")).toBeNull();
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
      scrolled(true);
      const backs = screen.getAllByRole("button", { name: "חזרה" });
      expect(backs).toHaveLength(2);
      fireEvent.click(backs[1] as HTMLElement);
      expect(screen.getByText("הרשימה")).toBeInTheDocument();
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
    });

    it("has no compact bar on a tab root, an inline header, or a screen with its own leading control", () => {
      observe();
      const { container } = render(
        <MemoryRouter>
          <>
            <ScreenHeader title="הגדרות" />
            <ScreenHeader title="לאישור" layout="inline" backTo="/" />
            <ScreenHeader title="הוצאה" leading={<button type="button">סגירה</button>} />
          </>
        </MemoryRouter>,
      );
      scrolled(true);
      expect(container.querySelector(".ui-compact-bar")).toBeNull();
      expect(container.querySelector(".ui-compact-mark")).toBeNull();
    });
  });
});
