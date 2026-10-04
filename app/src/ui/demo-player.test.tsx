import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DURATION_MAX_MS,
  DEMO_DURATION_MIN_MS,
  DemoPlayer,
  demoProgress,
  demoTranslateX,
  inlineSignForDirection,
  useDemoPlayback,
} from "./demo-player";
import css from "./demo-player.css?raw";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

function demoRoot(): HTMLElement {
  const el = document.querySelector(".ui-demo");
  if (!(el instanceof HTMLElement)) throw new Error("missing demo");
  return el;
}

function progressOf(el: HTMLElement): number {
  return Number(el.style.getPropertyValue("--demo-progress"));
}

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

describe("demo clock", () => {
  it("rests on the last frame for reduced motion and for a finished play", () => {
    expect(DEMO_DURATION_MIN_MS).toBe(3000);
    expect(DEMO_DURATION_MAX_MS).toBe(4600);
    expect(demoProgress(0, 4000, true)).toBe(1);
    expect(demoProgress(0, 4000, false)).toBe(0);
    expect(demoProgress(2000, 4000, false)).toBe(0.5);
    expect(demoProgress(3999, 4000, false)).toBeLessThan(1);
    expect(demoProgress(4000, 4000, false)).toBe(1);
    expect(demoProgress(9000, 4000, false)).toBe(1);
    expect(demoProgress(0, 0, false)).toBe(1);
    expect(inlineSignForDirection("rtl")).toBe(-1);
    expect(inlineSignForDirection("ltr")).toBe(1);
    expect(demoTranslateX(0, 24, -1)).toBe(24);
    expect(demoTranslateX(1, 24, -1)).toBe(0);
    expect(demoTranslateX(0, 24, 1)).toBe(-24);
    expect(demoTranslateX(0.5, 24, 1)).toBe(-12);
  });
});

describe("DemoPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("plays once, rests on the last frame, and replays from שוב", () => {
    expectRtl();
    vi.useFakeTimers();
    const seen: number[] = [];
    function Probe() {
      const { progress } = useDemoPlayback();
      seen.push(progress);
      return <span>תנועה לדוגמה</span>;
    }
    render(
      <DemoPlayer alt="הדגמה: מחברים את SUMIT, והתנועות נכנסות ללשונית לאישור." durationMs={4000}>
        <Probe />
      </DemoPlayer>,
    );
    const root = demoRoot();
    const phone = document.querySelector(".ui-demo-phone");
    expect(root).toHaveAttribute("data-demo-state", "playing");
    expect(progressOf(root)).toBe(0);
    expect(seen[0]).toBe(0);
    expect(screen.queryByRole("button", { name: "הצגה חוזרת" })).not.toBeInTheDocument();
    expect(phone).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".ui-demo-label")?.closest(".ui-demo-phone")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(root).toHaveAttribute("data-demo-state", "playing");
    expect(screen.queryByRole("button", { name: "הצגה חוזרת" })).not.toBeInTheDocument();
    const midway = progressOf(root);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(root).toHaveAttribute("data-demo-state", "settled");
    expect(progressOf(root)).toBe(1);
    const replay = screen.getByRole("button", { name: "הצגה חוזרת" });
    expect(replay).toHaveTextContent("שוב");
    expectTarget(replay);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(root).toHaveAttribute("data-demo-state", "settled");
    expect(progressOf(root)).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "הצגה חוזרת" }));
    expect(root).toHaveAttribute("data-demo-state", "playing");
    expect(progressOf(root)).toBe(0);
    expect(screen.queryByRole("button", { name: "הצגה חוזרת" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(root).toHaveAttribute("data-demo-state", "settled");
    expect(progressOf(root)).toBe(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "הצגה חוזרת" }));
  });

  it("shows the last frame immediately when motion is reduced, with no שוב", () => {
    stubReducedMotion(true);
    const seen: number[] = [];
    function Probe() {
      const { progress, reducedMotion, settled } = useDemoPlayback();
      seen.push(progress);
      return <span data-settled={settled ? "yes" : "no"}>{reducedMotion ? "מופחת" : "רגיל"}</span>;
    }
    const frames = vi.spyOn(window, "requestAnimationFrame");
    render(
      <DemoPlayer alt="הדגמה: לתנועה נוספת הצעה של פרויקט וקטגוריה, מסומנת הצעה." durationMs={4000}>
        <Probe />
      </DemoPlayer>,
    );
    const root = demoRoot();
    expect(root).toHaveAttribute("data-demo-state", "settled");
    expect(root).toHaveAttribute("data-reduced-motion", "true");
    expect(progressOf(root)).toBe(1);
    expect(seen.every((value) => value === 1)).toBe(true);
    expect(screen.getByText("הדגמה: לתנועה נוספת הצעה של פרויקט וקטגוריה, מסומנת הצעה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הצגה חוזרת" })).not.toBeInTheDocument();
    expect(frames).not.toHaveBeenCalled();
  });

  it("waits until the stage is on screen, and pauses while the tab is hidden", () => {
    vi.useFakeTimers();
    const observers: FakeObserver[] = [];
    class FakeObserver {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target: Element) {
        this.callback([{ isIntersecting: false, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      fire(visible: boolean) {
        const target = document.querySelector(".ui-demo");
        if (!target) return;
        this.callback([{ isIntersecting: visible, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(
      <DemoPlayer alt="הדגמה" durationMs={4000}>
        <span>שלום</span>
      </DemoPlayer>,
    );
    const root = demoRoot();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(progressOf(root)).toBe(0);
    expect(root).toHaveAttribute("data-demo-state", "playing");

    act(() => {
      observers[0]?.fire(true);
      vi.advanceTimersByTime(2000);
    });
    const midway = progressOf(root);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const paused = progressOf(root);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(progressOf(root)).toBe(paused);
    expect(root).toHaveAttribute("data-demo-state", "playing");

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(root).toHaveAttribute("data-demo-state", "settled");
    expect(progressOf(root)).toBe(1);
  });

  it("sets the inline sign from direction", () => {
    vi.useFakeTimers();
    render(
      <DemoPlayer alt="הדגמה" durationMs={4000}>
        <span>שלום</span>
      </DemoPlayer>,
    );
    expect(demoRoot().style.getPropertyValue("--inline-sign")).toBe("-1");

    document.documentElement.dir = "ltr";
    const { container } = render(
      <div dir="ltr">
        <DemoPlayer alt="הדגמה" durationMs={4000}>
          <span>שלום</span>
        </DemoPlayer>
      </div>,
    );
    const ltr = container.querySelector(".ui-demo");
    if (!(ltr instanceof HTMLElement)) throw new Error("missing ltr demo");
    expect(getComputedStyle(ltr).direction).toBe("ltr");
    expect(ltr.style.getPropertyValue("--inline-sign")).toBe("1");
  });

  it("moves only with transform and opacity, signed for RTL", () => {
    expect(css).toContain("translateX(calc(var(--inline-sign) * (var(--demo-progress) - 1) * var(--demo-travel, 24px)))");
    expect(css).toContain("opacity: var(--demo-progress)");
    expect(css).toContain("clamp(200px, calc(200px + (100vw - 320px) * 120 / 70), 320px)");
    expect(css).toContain("clamp(150px, calc(150px + (100vw - 320px) * 46 / 70), 196px)");
    expect(css).toContain("var(--demo-phone) / 320px");
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/\banimation\s*:/);
    expect(css).not.toMatch(/\btransition\s*:/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toContain("transform: none");
    const stage = document.createElement("div");
    stage.className = "ui-demo";
    document.body.append(stage);
    expectThemePaint(stage, "backgroundColor");
    stage.remove();
  });

  it("refuses the playback hook outside the player", () => {
    function Bare() {
      useDemoPlayback();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/DemoPlayer/);
  });
});
