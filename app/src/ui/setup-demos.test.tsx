import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
      expect(screen.queryByRole("button", { name: "הצגה חוזרת" })).not.toBeInTheDocument();
      view.unmount();
    }
    check(<SumitConnectDemo />, () => {
      expect(screen.getByText(SUMIT_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("ספק לדוגמה בע״מ");
      expect(visibleText()).toContain("מחובר");
      expect(visibleText()).toContain("8,500");
      expect(visibleText()).toContain("12");
    });
    check(<JevSwitchDemo />, () => {
      expect(screen.getByText(JEV_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("הצעה");
      expect(visibleText()).toContain("פרויקט לדוגמה");
      expect(visibleText()).toContain("קטגוריה לדוגמה");
    });
    check(<ProjectsDemo />, () => {
      expect(screen.getByText(PROJECTS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("מוסתרות");
      expect(visibleText()).toContain("פרויקט לדוגמה");
      expect(visibleText()).not.toContain("קטגוריה ג׳");
    });
    check(<FirstApprovalDemo />, () => {
      expect(screen.getByText(APPROVAL_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
      expect(visibleText()).toContain("ספק נוסף לדוגמה");
      expect(visibleText()).not.toContain("ספק לדוגמה בע״מ");
    });
    check(<IosInstallDemo />, () => {
      expect(screen.getByText(IOS_ALT)).toBeInTheDocument();
      expect(frame()).toBe("4");
      expect(visibleText()).toContain("פתיחה כאפליקציה");
      expect(visibleText()).toContain("הוספה");
      expect(visibleText()).toContain(demoHost());
      expect(visibleText()).not.toContain("שיתוף");
    });
    check(<AndroidInstallDemo />, () => {
      expect(screen.getByText(ANDROID_ALT)).toBeInTheDocument();
      expect(frame()).toBe("3");
      expect(visibleText()).toContain(demoHost());
      expect(visibleText()).not.toContain("התקנה");
      expect(document.body.textContent).not.toMatch(/@/);
    });
  });

  it("plays the SUMIT sheet into לאישור, then offers שוב", () => {
    vi.useFakeTimers();
    render(<SumitConnectDemo />);
    expect(frame()).toBe("1");
    expect(visibleText()).toContain("מספר חברה");
    expect(visibleText()).not.toContain("ספק לדוגמה בע״מ");
    act(() => {
      vi.advanceTimersByTime(SUMIT_DEMO_MS + 200);
    });
    expect(frame()).toBe("4");
    expect(visibleText()).toContain("ספק לדוגמה בע״מ");
    expect(screen.getByRole("button", { name: "הצגה חוזרת" })).toHaveTextContent("שוב");
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
});
