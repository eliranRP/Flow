import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollMemory } from "./back";
import { ScreenHeader } from "./screen-header";
import { expectRtl, expectTarget, stubPageObserver } from "./test-support";
import { type ReactElement } from "react";
import { ScreenState } from "./screen-state";
import { SKELETON_DELAY_MS, SKELETON_FADE_MS } from "./skeleton";

// --- screen-header.test.tsx

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
    // FLOW-363 3a: the stacked title is 32/600, the `t-title` role.
    expect(title).toHaveClass("t-title");
    expect(title).not.toHaveClass("t-total");
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
    expect(header?.querySelector("p.t-caption.t-muted")).toBeNull();
    // The compact bar is mounted at the end, hidden; the page's own order is what is checked.
    const order = Array.from(header?.children ?? [])
      .filter((node) => !node.classList.contains("ui-compact-bar"))
      .map((node) => node.textContent);
    expect(order).toEqual(["הגדרות", "קטגוריות", "", "שורה"]);
  });

  it("labels Back only when Back goes to the kicker's screen", () => {
    function at(idx: number, path: string) {
      window.history.replaceState({ idx }, "");
      return render(
        <MemoryRouter initialEntries={[path]}>
          <ScrollMemory />
          <ScreenHeader title="חיבורים" kicker="הגדרות" backTo="/settings" />
        </MemoryRouter>,
      );
    }
    try {
      // Opened from Home: Back pops to Home, so it is the icon, not "‹ הגדרות".
      at(0, "/").unmount();
      const fromHome = at(1, "/settings/connections");
      expect(screen.getByRole("button", { name: "חזרה" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "חזרה להגדרות" })).not.toBeInTheDocument();
      fromHome.unmount();
      // Opened from Settings: Back pops to Settings, so it says so.
      at(0, "/settings").unmount();
      at(1, "/settings/connections");
      expect(screen.getByRole("button", { name: "חזרה להגדרות" })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "");
    }
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
    expect(screen.getByText("פרויקט")).toHaveClass("t-caption t-muted");
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
      // The bar stays mounted and hidden until the title scrolls off.
      const bar = container.querySelector(".ui-compact-bar") as HTMLElement;
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(bar).toHaveAttribute("inert");
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
      scrolled(true);
      expect(bar).toHaveClass("m-bar-in");
      expect(bar).toHaveAttribute("aria-hidden", "false");
      expect(bar).not.toHaveAttribute("inert");
      expect(bar).toHaveTextContent("שויכו היום");
      expect(document.documentElement).toHaveAttribute("data-compact-bar", "list");
      // The page's h1 is still the only heading.
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      scrolled(false);
      expect(bar).toHaveClass("m-bar-out");
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
      act(() => {
        fireEvent.animationEnd(bar);
      });
      expect(bar).toHaveClass("ui-compact-bar-gone");
      scrolled(true);
      const backs = screen.getAllByRole("button", { name: "חזרה" });
      expect(backs).toHaveLength(2);
      fireEvent.click(backs[1] as HTMLElement);
      expect(screen.getByText("הרשימה")).toBeInTheDocument();
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
    });

    it("puts the mark after the below row when a panel rides under the bar", () => {
      observe();
      const { container } = render(
        <MemoryRouter initialEntries={["/review", "/review/filed"]} initialIndex={1}>
          <Routes>
            <Route path="/review" element={<p>הרשימה</p>} />
            <Route
              path="/review/filed"
              element={<ScreenHeader title="יצא" backTo="/review" below={<span>תקופה</span>} panel={<span>לפי תאריך</span>} />}
            />
          </Routes>
        </MemoryRouter>,
      );
      const below = container.querySelector(".ui-page-below");
      expect(below?.nextElementSibling).toHaveClass("ui-compact-mark");
      expect(container.querySelector(".ui-page > .ui-compact-mark")).not.toBeNull();
      scrolled(true);
      expect(document.documentElement).toHaveAttribute("data-compact-bar", "panel");
      expect(container.querySelector(".ui-compact-bar")).toHaveTextContent("לפי תאריך");
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

    it("follows the mark when it moves to a new node, so the bar stays up at the top", () => {
      const observer = stubPageObserver();
      const header = (panel: boolean) => (
        <MemoryRouter>
          <ScreenHeader title="רווח" backTo="/" below={<span>תקופה</span>} panel={panel ? <span>לפי חודש</span> : undefined} />
        </MemoryRouter>
      );
      const { container, rerender } = render(header(true));
      const bar = container.querySelector(".ui-compact-bar") as HTMLElement;
      const first = container.querySelector(".ui-compact-mark");
      expect(bar).toHaveAttribute("aria-hidden", "true");
      // A skeleton with no panel puts the mark after the title: React draws a new node there.
      rerender(header(false));
      expect(container.querySelector(".ui-compact-mark")).not.toBe(first);
      observer.settle();
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
      rerender(header(true));
      observer.settle();
      expect(bar).toHaveAttribute("aria-hidden", "true");
      // A tall page still brings the bar down once the new mark scrolls off, and up again at the top.
      observer.page.scrolled = true;
      observer.settle();
      expect(bar).toHaveAttribute("aria-hidden", "false");
      observer.page.scrolled = false;
      observer.settle();
      expect(bar).toHaveAttribute("aria-hidden", "true");
    });
  });
});
// --- screen-state.test.tsx

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const SYNC_LABEL = "מסנכרן עם Mercury…";

function loadingState(): ReactElement {
  return <ScreenState title="פרויקטים" phase={{ kind: "loading" }} onRetry={() => undefined} />;
}

describe("ScreenState loading (FLOW-371)", () => {
  it("shows no skeleton before 300ms, then the skeleton", () => {
    const { container } = render(<MemoryRouter>{loadingState()}</MemoryRouter>);
    expect(container.querySelector(".ui-skel-row")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(container.querySelectorAll(".ui-skel-row").length).toBeGreaterThan(0);
  });

  it("fades the skeleton out over 200ms once the load ends", () => {
    const view = render(<MemoryRouter>{loadingState()}</MemoryRouter>);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(view.container.querySelector(".ui-skel-row")).not.toBeNull();

    view.rerender(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    expect(view.container.querySelector(".ui-skel-leaving")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(SKELETON_FADE_MS - 1);
    });
    expect(view.container.querySelector(".ui-skel-leaving")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.container.querySelector(".ui-skel-leaving")).toBeNull();
    expect(screen.getByText("תוכן")).toBeInTheDocument();
  });

  it("never shows a skeleton for a load that ends within 300ms", () => {
    const view = render(<MemoryRouter>{loadingState()}</MemoryRouter>);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    view.rerender(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    act(() => {
      vi.advanceTimersByTime(SKELETON_FADE_MS + SKELETON_DELAY_MS);
    });
    expect(view.container.querySelector(".ui-skel-row")).toBeNull();
    expect(view.container.querySelector(".ui-skel-leaving")).toBeNull();
  });

  it("fades the ready content in over 200ms", () => {
    const { container } = render(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    expect(screen.getByText("תוכן").parentElement).toHaveClass("ui-phase-in");
    expect(container.querySelector(".ui-skel-row")).toBeNull();
  });

  it("shows the sync strip with its label while a sync runs", () => {
    render(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined} syncing={SYNC_LABEL}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(SYNC_LABEL);
  });
});