import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_DURATION_MAX_MS, DEMO_DURATION_MIN_MS } from "./demo-player";
import {
  ANDROID_ALT,
  ANDROID_DEMO_MS,
  AndroidInstallDemo,
  APPROVAL_ALT,
  APPROVAL_DEMO_MS,
  demoBeat,
  demoFrame,
  demoHost,
  demoVat,
  easeExit,
  FirstApprovalDemo,
  IOS_ALT,
  IOS_DEMO_MS,
  IosInstallDemo,
  JEV_ALT,
  JEV_DEMO_MS,
  JevSwitchDemo,
  PROJECTS_ALT,
  PROJECTS_DEMO_MS,
  ProjectsDemo,
  SUMIT_ALT,
  SUMIT_DEMO_MS,
  SumitConnectDemo,
} from "./setup-demos";
import css from "./setup-demos.css?raw";
import source from "./setup-demos.tsx?raw";

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function frame(): string {
  return document.querySelector(".ui-setup-demo")?.getAttribute("data-demo-frame") ?? "";
}

function visibleText(): string {
  return [...document.querySelectorAll("[data-setup-visible='true']")].map((node) => node.textContent).join("\n");
}

function demoText(): string {
  return document.querySelector(".ui-setup-demo")?.textContent ?? "";
}

describe("demo timeline", () => {
  it("keeps every storyboard inside 3–5s and eases the exit", () => {
    for (const duration of [SUMIT_DEMO_MS, JEV_DEMO_MS, PROJECTS_DEMO_MS, APPROVAL_DEMO_MS, ANDROID_DEMO_MS]) {
      expect(duration).toBeGreaterThanOrEqual(DEMO_DURATION_MIN_MS);
      expect(duration).toBeLessThanOrEqual(DEMO_DURATION_MAX_MS);
    }
    expect(IOS_DEMO_MS).toBeGreaterThan(DEMO_DURATION_MAX_MS);
    expect(IOS_DEMO_MS).toBeLessThanOrEqual(5000);
    expect(SUMIT_DEMO_MS).toBe(4120);
    expect(JEV_DEMO_MS).toBe(3800);
    expect(PROJECTS_DEMO_MS).toBe(3700);
    expect(APPROVAL_DEMO_MS).toBe(3350);
    expect(IOS_DEMO_MS).toBe(4750);
    expect(ANDROID_DEMO_MS).toBe(3580);
    expect(demoBeat(0, 0.2, 0.4)).toBe(0);
    expect(demoBeat(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(demoBeat(1, 0.2, 0.4)).toBe(1);
    expect(demoFrame(0, [0.25, 0.5])).toBe(1);
    expect(demoFrame(0.5, [0.25, 0.5])).toBe(3);
    expect(easeExit(0)).toBe(0);
    expect(easeExit(1)).toBe(1);
    expect(easeExit(0.5)).toBeGreaterThan(0);
    expect(easeExit(0.5)).toBeLessThan(1);
    expect(css).toContain("translateX(calc(var(--inline-sign) * var(--setup-leave, 0) * 40%))");
    expect(css).toContain(".ui-setup-stack > .ui-setup-leave");
    expect(css).toContain(".ui-setup-stack > .ui-setup-fade");
    expect(css).toMatch(/\.ui-setup-stack \{[^}]*position: relative/);
    expect(css).toMatch(/\.ui-setup-stack > \.ui-setup-leave,\s*\.ui-setup-stack > \.ui-setup-fade \{[^}]*position: absolute/);
    // The skeleton frame is still: the Skeleton's own still bar, not a rule reaching into it (FLOW-506).
    expect(source).toMatch(/<Skeleton [^>]*\bstill\b/);
    expect(css).not.toContain(".ui-skeleton-bar");
    expect(css).not.toContain(".ui-app-icon");
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/\btransition\s*:/);
    expect(source.includes("flow.app")).toBe(false);
    expect(source.includes("נתוני דוגמה")).toBe(false);
    expect(css).toContain("border: 2px solid var(--color-accent)");
    expect(css).toContain("rgba(255, 255, 255, 0.55)");
    expect(css).toContain("rgba(241, 237, 248, 0.38)");
    expect(css).toContain("#1d1728");
    expect(css).not.toContain("polygon");
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of stripped.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
      const body = match[1] ?? "";
      if (!body.includes("--setup-")) continue;
      for (const declaration of body.split(";")) {
        const property = declaration.split(":")[0]?.trim() ?? "";
        if (property === "") continue;
        expect(["opacity", "transform"]).toContain(property);
      }
    }
  });
});

describe("demoVat (FLOW-506)", () => {
  it("is the standard rate on the before-VAT amount, half to even", () => {
    expect(demoVat(850_000n)).toBe(153_000n);
    expect(demoVat(234_000n)).toBe(42_120n);
    expect(demoVat(25n)).toBe(4n);
    expect(demoVat(0n)).toBe(0n);
  });
});

describe("setup demos", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rests each storyboard on its last frame, with no שוב when motion is reduced", () => {
    stubReducedMotion(true);
    function check(node: ReactNode, assert: () => void) {
      const view = render(node);
      assert();
      expect(screen.queryByRole("button", { name: "שוב" })).not.toBeInTheDocument();
      expect(document.querySelector(".ui-demo-pointer")).not.toBeInTheDocument();
      expect(document.querySelector(".ui-demo-phone")?.textContent ?? "").not.toContain("נתוני דוגמה");
      view.unmount();
    }
    check(
      <MemoryRouter initialEntries={["/review"]}>
        <SumitConnectDemo />
      </MemoryRouter>,
      () => {
        expect(screen.getByText(SUMIT_ALT)).toBeInTheDocument();
        expect(frame()).toBe("4");
        expect(visibleText()).toContain("חומרי בניין הדר");
        expect(visibleText()).toContain("אבי חשמל");
        expect(visibleText()).toContain("וילה רעננה");
        expect(visibleText()).toContain("מחובר");
        expect(visibleText()).toContain("8,500");
        expect(visibleText()).toContain("2,340");
        expect(visibleText()).toContain("45,000");
        expect(visibleText()).toContain("21/09");
        expect(visibleText()).toContain("12");
        expect(visibleText()).toContain("בית");
        expect(visibleText()).toContain("הגדרות");
        expect(visibleText()).toContain("הוצאה ·");
        expect(visibleText()).toContain("הכנסה ·");
        expect(document.querySelector(".ui-setup-lead")).toBeInTheDocument();
        expect(document.querySelector(".ui-setup-stat")).toBeInTheDocument();
        expect(document.querySelector(".ui-tabbar")).not.toBeInTheDocument();
      },
    );
    check(<JevSwitchDemo />, () => {
      expect(screen.getByText(JEV_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(demoText()).toContain("לאישור");
      expect(demoText()).toContain("הצעה");
      expect(demoText()).toContain("חומרי בניין הדר בע״מ");
      expect(demoText()).toContain("וילה רעננה");
      expect(demoText()).toContain("חומרים");
      expect(demoText()).toContain("21/09/2026");
      expect(demoText()).toContain("8,500");
      expect(demoText()).toContain("1,530");
      expect(demoText()).toContain("תיוג חכם");
      expect(document.querySelector(".ui-setup-jev .ui-row-chevron")).not.toBeInTheDocument();
      expect(document.querySelector(".ui-setup-pill")).toBeInTheDocument();
    });
    check(<ProjectsDemo />, () => {
      expect(screen.getByText(PROJECTS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("מוסתרות");
      expect(demoText()).toContain("פרויקטים");
      expect(demoText()).toContain("קטגוריות");
      expect(demoText()).toContain("מגדל משרדים לוד");
      expect(demoText()).toContain("רכב");
      expect(demoText()).not.toContain("פרסום");
    });
    check(<FirstApprovalDemo />, () => {
      expect(screen.getByText(APPROVAL_ALT)).toBeInTheDocument();
      expect(frame()).toBe("2");
      expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
      expect(visibleText()).toContain("נשארו");
      expect(visibleText()).toContain("לאישור");
      expect(visibleText()).toContain("הצעה");
      expect(visibleText()).toContain("אבי חשמל");
      expect(visibleText()).toContain("2,340");
      expect(visibleText()).toContain("₪421");
      expect(visibleText()).toContain("קבלני משנה");
      expect(visibleText()).not.toContain("חומרי בניין הדר בע״מ");
    });
    check(<IosInstallDemo />, () => {
      expect(screen.getByText(IOS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("5");
      expect(visibleText()).toContain("Flow");
      expect(document.querySelectorAll(".ui-setup-home > *")).toHaveLength(8);
      expect(document.querySelector(".ui-setup-home")?.children[6]?.textContent).toContain("Flow");
      expect(document.querySelector(".ui-setup-home")).toHaveAttribute("dir", "ltr");
      expect(visibleText()).not.toContain("שיתוף");
      expect(visibleText()).not.toContain(demoHost());
    });
    check(<AndroidInstallDemo />, () => {
      expect(screen.getByText(ANDROID_ALT)).toBeInTheDocument();
      expect(frame()).toBe("3");
      expect(visibleText()).toContain("Flow");
      expect(document.querySelectorAll(".ui-setup-home > *")).toHaveLength(8);
      expect(document.querySelector(".ui-setup-home")?.children[6]?.textContent).toContain("Flow");
      expect(document.querySelector(".ui-setup-home")).toHaveAttribute("dir", "ltr");
      expect(visibleText()).not.toContain("התקנה");
      expect(visibleText()).not.toContain(demoHost());
      expect(document.body.textContent).not.toMatch(/@/);
    });
  });

  it("plays the SUMIT sheet into לאישור, then offers שוב", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/review"]}>
        <SumitConnectDemo />
      </MemoryRouter>,
    );
    expect(frame()).toBe("1");
    expect(visibleText()).toContain("מספר חברה");
    expect(visibleText()).not.toContain("חומרי בניין הדר");
    act(() => {
      vi.advanceTimersByTime(SUMIT_DEMO_MS + 200);
    });
    expect(frame()).toBe("4");
    expect(visibleText()).toContain("חומרי בניין הדר");
    expect(screen.getByRole("button", { name: "שוב" })).toHaveTextContent("שוב");
  });

  it("swaps the approval count from 12 to 11", () => {
    vi.useFakeTimers();
    render(<FirstApprovalDemo />);
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("12");
    expect(visibleText()).toContain("חומרי בניין הדר בע״מ");
    act(() => {
      vi.advanceTimersByTime(APPROVAL_DEMO_MS + 200);
    });
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
    expect(visibleText()).toContain("אבי חשמל");
    expect(visibleText()).not.toContain("חומרי בניין הדר בע״מ");
  });

  it("keeps the Jev pills off frame 1 and fills the card rows later", () => {
    vi.useFakeTimers();
    render(<JevSwitchDemo />);
    expect(frame()).toBe("1");
    expect(demoText()).not.toContain("וילה רעננה");
    expect(demoText()).not.toContain("חומרים");
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(frame()).toBe("3");
    expect(demoText()).toContain("הצעה");
    expect(demoText()).not.toContain("וילה רעננה");
    act(() => {
      vi.advanceTimersByTime(JEV_DEMO_MS);
    });
    expect(frame()).toBe("4");
    expect(demoText()).toContain("וילה רעננה");
    expect(demoText()).toContain("חומרים");
  });

  it("walks projects from an empty list to four remaining chips", () => {
    vi.useFakeTimers();
    render(<ProjectsDemo />);
    expect(frame()).toBe("1");
    expect(demoText()).not.toContain("וילה רעננה");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(frame()).toBe("2");
    expect(demoText()).toContain("וילה רעננה");
    expect(demoText()).not.toContain("חומרים");
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(demoText()).toContain("חומרים");
    expect(demoText()).toContain("פרסום");
    expect(visibleText()).not.toContain("מוסתרות");
    act(() => {
      vi.advanceTimersByTime(PROJECTS_DEMO_MS);
    });
    expect(frame()).toBe("4");
    expect(visibleText()).toContain("מוסתרות");
    expect(demoText()).not.toContain("פרסום");
  });

  it("keeps Hebrew rows RTL and the Safari bar LTR", () => {
    vi.useFakeTimers();
    render(<IosInstallDemo />);
    const bar = document.querySelector(".ui-setup-safari-bar");
    const row = document.querySelector(".ui-setup-menu-row");
    expect(bar).toHaveAttribute("dir", "ltr");
    expect(bar?.textContent).toContain(demoHost());
    expect(row).not.toHaveAttribute("dir", "ltr");
    if (!(row instanceof HTMLElement)) throw new Error("missing menu row");
    expect(getComputedStyle(row).direction).toBe("rtl");
    expect(frame()).toBe("1");
    expect(visibleText()).not.toContain("שיתוף");
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(frame()).toBe("2");
    expect(visibleText()).toContain("שיתוף");
    expect(visibleText()).not.toContain("הוספה למסך הבית");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(visibleText()).toContain("הוספה למסך הבית");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(visibleText()).toContain("פתיחה כאפליקציה");
    act(() => {
      vi.advanceTimersByTime(IOS_DEMO_MS);
    });
    expect(frame()).toBe("5");
    expect(visibleText()).toContain("Flow");
  });

  it("puts the Android install dialog over a scrim, then a Flow icon", () => {
    vi.useFakeTimers();
    render(<AndroidInstallDemo />);
    expect(frame()).toBe("1");
    expect(visibleText()).toContain("התקנה");
    expect(visibleText()).not.toContain("להתקין את Flow?");
    const dialog = document.querySelector(".ui-setup-dialog");
    expect(dialog).not.toHaveAttribute("dir", "ltr");
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(frame()).toBe("2");
    expect(visibleText()).toContain("להתקין את Flow?");
    expect(visibleText()).toContain(demoHost());
    expect(visibleText()).toContain("ביטול");
    act(() => {
      vi.advanceTimersByTime(ANDROID_DEMO_MS);
    });
    expect(frame()).toBe("3");
    expect(visibleText()).toContain("Flow");
    expect(visibleText()).not.toContain("התקנה");
  });
});
