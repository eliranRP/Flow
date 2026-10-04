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
  it("keeps every storyboard inside 3.0–4.6s and eases the exit", () => {
    for (const duration of [SUMIT_DEMO_MS, JEV_DEMO_MS, PROJECTS_DEMO_MS, APPROVAL_DEMO_MS, IOS_DEMO_MS, ANDROID_DEMO_MS]) {
      expect(duration).toBeGreaterThanOrEqual(DEMO_DURATION_MIN_MS);
      expect(duration).toBeLessThanOrEqual(DEMO_DURATION_MAX_MS);
    }
    expect(SUMIT_DEMO_MS).toBe(4000);
    expect(JEV_DEMO_MS).toBe(3600);
    expect(PROJECTS_DEMO_MS).toBe(4000);
    expect(APPROVAL_DEMO_MS).toBe(4000);
    expect(IOS_DEMO_MS).toBe(4600);
    expect(ANDROID_DEMO_MS).toBe(3000);
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
    expect(css).toContain("animation: none");
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/\btransition\s*:/);
    expect(source.includes("flow.app")).toBe(false);
    expect(source.includes("נתוני דוגמה")).toBe(false);
    expect(css).toContain("background: var(--color-accent)");
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
        expect(visibleText()).toContain("ספק לדוגמה בע״מ");
        expect(visibleText()).toContain("מחובר");
        expect(visibleText()).toContain("8,500");
        expect(visibleText()).toContain("12");
        expect(visibleText()).toContain("מחובר");
        expect(visibleText()).toContain("הוצאה ·");
        expect(visibleText()).toContain("הכנסה ·");
      },
    );
    check(<JevSwitchDemo />, () => {
      expect(screen.getByText(JEV_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(demoText()).toContain("לאישור");
      expect(demoText()).toContain("הצעה");
      expect(demoText()).toContain("פרויקט לדוגמה");
      expect(demoText()).toContain("קטגוריה לדוגמה");
      expect(demoText()).not.toContain("תיוג חכם");
    });
    check(<ProjectsDemo />, () => {
      expect(screen.getByText(PROJECTS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("מוסתרות");
      expect(demoText()).toContain("פרויקטים");
      expect(demoText()).toContain("קטגוריות");
      expect(demoText()).toContain("פרויקט שלישי לדוגמה");
      expect(demoText()).toContain("קטגוריה ד׳");
      expect(demoText()).not.toContain("קטגוריה ה׳");
    });
    check(<FirstApprovalDemo />, () => {
      expect(screen.getByText(APPROVAL_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
      expect(visibleText()).toContain("נשארו");
      expect(visibleText()).toContain("לאישור");
      expect(visibleText()).toContain("הצעה");
      expect(visibleText()).toContain("ספק נוסף לדוגמה");
      expect(visibleText()).not.toContain("ספק לדוגמה בע״מ");
    });
    check(<IosInstallDemo />, () => {
      expect(screen.getByText(IOS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("5");
      expect(visibleText()).toContain("Flow");
      expect(visibleText()).not.toContain("שיתוף");
      expect(visibleText()).not.toContain(demoHost());
    });
    check(<AndroidInstallDemo />, () => {
      expect(screen.getByText(ANDROID_ALT)).toBeInTheDocument();
      expect(frame()).toBe("3");
      expect(visibleText()).toContain("Flow");
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
    expect(visibleText()).not.toContain("ספק לדוגמה בע״מ");
    act(() => {
      vi.advanceTimersByTime(SUMIT_DEMO_MS + 200);
    });
    expect(frame()).toBe("4");
    expect(visibleText()).toContain("ספק לדוגמה בע״מ");
    expect(screen.getByRole("button", { name: "שוב" })).toHaveTextContent("שוב");
  });

  it("swaps the approval count from 12 to 11", () => {
    vi.useFakeTimers();
    render(<FirstApprovalDemo />);
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("12");
    expect(visibleText()).toContain("ספק לדוגמה בע״מ");
    act(() => {
      vi.advanceTimersByTime(APPROVAL_DEMO_MS + 200);
    });
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
    expect(visibleText()).toContain("ספק נוסף לדוגמה");
    expect(visibleText()).not.toContain("ספק לדוגמה בע״מ");
  });

  it("keeps the Jev pills off frame 1 and fills the card rows later", () => {
    vi.useFakeTimers();
    render(<JevSwitchDemo />);
    expect(frame()).toBe("1");
    expect(demoText()).not.toContain("פרויקט לדוגמה");
    expect(demoText()).not.toContain("קטגוריה לדוגמה");
    act(() => {
      vi.advanceTimersByTime(JEV_DEMO_MS * 0.66);
    });
    expect(frame()).toBe("3");
    expect(demoText()).toContain("פרויקט לדוגמה");
    expect(demoText()).not.toContain("קטגוריה לדוגמה");
    act(() => {
      vi.advanceTimersByTime(JEV_DEMO_MS);
    });
    expect(demoText()).toContain("קטגוריה לדוגמה");
  });

  it("walks projects from an empty list to four remaining chips", () => {
    vi.useFakeTimers();
    render(<ProjectsDemo />);
    expect(frame()).toBe("1");
    expect(demoText()).not.toContain("פרויקט לדוגמה");
    act(() => {
      vi.advanceTimersByTime(PROJECTS_DEMO_MS * 0.34);
    });
    expect(frame()).toBe("2");
    expect(demoText()).toContain("פרויקט לדוגמה");
    expect(demoText()).not.toContain("קטגוריה א׳");
    act(() => {
      vi.advanceTimersByTime(PROJECTS_DEMO_MS * 0.28);
    });
    expect(demoText()).toContain("קטגוריה א׳");
    expect(demoText()).toContain("קטגוריה ב׳");
    expect(visibleText()).not.toContain("מוסתרות");
    act(() => {
      vi.advanceTimersByTime(PROJECTS_DEMO_MS);
    });
    expect(frame()).toBe("4");
    expect(visibleText()).toContain("מוסתרות");
    expect(demoText()).not.toContain("קטגוריה ה׳");
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
      vi.advanceTimersByTime(1100);
    });
    expect(frame()).toBe("2");
    expect(visibleText()).toContain("שיתוף");
    expect(visibleText()).not.toContain("הוספה למסך הבית");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(visibleText()).toContain("הוספה למסך הבית");
    act(() => {
      vi.advanceTimersByTime(1200);
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
