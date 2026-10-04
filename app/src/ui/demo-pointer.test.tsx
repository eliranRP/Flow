import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pointerPose, POINTER_REACT_MS } from "./demo-pointer";
import pointerSource from "./demo-pointer.tsx?raw";
import {
  ANDROID_DEMO_MS,
  ANDROID_POINTER,
  APPROVAL_DEMO_MS,
  APPROVAL_POINTER,
  AndroidInstallDemo,
  FirstApprovalDemo,
  IOS_DEMO_MS,
  IOS_POINTER,
  IosInstallDemo,
  JEV_DEMO_MS,
  JEV_POINTER,
  JevSwitchDemo,
  PROJECTS_DEMO_MS,
  PROJECTS_POINTER,
  ProjectsDemo,
  SUMIT_DEMO_MS,
  SUMIT_POINTER,
  SumitConnectDemo,
} from "./setup-demos";

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

function clock() {
  let now = 0;
  return (ms: number) => {
    const delta = ms - now;
    now = ms;
    act(() => {
      vi.advanceTimersByTime(delta);
    });
  };
}

function pointerOpacity(): number {
  const node = document.querySelector(".ui-demo-pointer");
  if (!(node instanceof HTMLElement)) return -1;
  return Number(node.style.opacity);
}

function inputValue(label: string): string {
  const lab = [...document.querySelectorAll(".ui-setup-demo label")].find((node) => node.textContent === label);
  const id = lab?.getAttribute("for");
  if (!id) return "";
  const input = document.getElementById(id);
  return input instanceof HTMLInputElement ? input.value : "";
}

function visibleText(): string {
  return [...document.querySelectorAll("[data-setup-visible='true']")].map((node) => node.textContent).join("\n");
}

describe("pointer pose", () => {
  it("fades out before the demo ends, and the press meets the ripple", () => {
    expect(pointerSource).not.toContain("rgba(255, 255, 255, 0.55)");
    expect(pointerSource).not.toContain("#1d1728");
    const samples = [
      [SUMIT_POINTER, SUMIT_DEMO_MS],
      [JEV_POINTER, JEV_DEMO_MS],
      [PROJECTS_POINTER, PROJECTS_DEMO_MS],
      [APPROVAL_POINTER, APPROVAL_DEMO_MS],
      [IOS_POINTER, IOS_DEMO_MS],
      [ANDROID_POINTER, ANDROID_DEMO_MS],
    ] as const;
    for (const [timeline, duration] of samples) {
      const fadeEnd = timeline.fadeOut.start + timeline.fadeOut.duration;
      expect(fadeEnd).toBeLessThan(duration);
      expect(pointerPose(0, timeline).opacity).toBe(0);
      expect(pointerPose(timeline.fadeIn.start + timeline.fadeIn.duration, timeline).opacity).toBe(1);
      expect(pointerPose(fadeEnd, timeline).opacity).toBe(0);
      expect(pointerPose(duration, timeline).opacity).toBe(0);
      for (const tap of timeline.taps) {
        expect(pointerPose(tap, timeline).scale).toBeCloseTo(1);
        expect(pointerPose(tap, timeline).rippleOpacity).toBeCloseTo(0.35);
        expect(pointerPose(tap, timeline).ring).toBeCloseTo(1);
        expect(pointerPose(tap + 260, timeline).scale).toBeCloseTo(1);
        expect(pointerPose(tap + 300, timeline).rippleOpacity).toBe(0);
        let dipped = 1;
        for (let t = 0; t <= 260; t += 1) dipped = Math.min(dipped, pointerPose(tap + t, timeline).scale);
        expect(dipped).toBeGreaterThan(0.89);
        expect(dipped).toBeLessThan(0.91);
      }
    }
    const move = SUMIT_POINTER.moves[0];
    if (!move) throw new Error("missing move");
    expect(pointerPose(move.start, SUMIT_POINTER).moveT).toBe(0);
    expect(pointerPose(move.start + move.duration, SUMIT_POINTER).moveT).toBe(1);
    expect(pointerPose(move.start + move.duration / 4, SUMIT_POINTER).moveT).toBeLessThan(0.25);
  });
});

describe("pointer on the storyboards", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides the pointer under reduced motion, including the arrow", () => {
    stubReducedMotion(true);
    render(
      <MemoryRouter initialEntries={["/review"]}>
        <SumitConnectDemo pointer="arrow" />
      </MemoryRouter>,
    );
    expect(document.querySelector(".ui-demo-pointer")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-demo-pointer-arrow")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שוב" })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-setup-demo")?.getAttribute("data-demo-frame")).toBe("4");
  });

  it("uses the dot unless the arrow variant is asked for", () => {
    vi.useFakeTimers();
    const dot = render(<JevSwitchDemo />);
    expect(document.querySelector(".ui-demo-pointer")).toHaveAttribute("data-variant", "dot");
    expect(document.querySelector(".ui-demo-pointer-dot")).toBeInTheDocument();
    expect(document.querySelector(".ui-demo-pointer-arrow")).not.toBeInTheDocument();
    dot.unmount();
    render(<JevSwitchDemo pointer="arrow" />);
    expect(document.querySelector(".ui-demo-pointer")).toHaveAttribute("data-variant", "arrow");
    expect(document.querySelector(".ui-demo-pointer-arrow")).toBeInTheDocument();
    expect(document.querySelector(".ui-demo-pointer-dot")).not.toBeInTheDocument();
  });

  it("fades the pointer out before the resting frame holds שוב", () => {
    vi.useFakeTimers();
    const demos: Array<[ReactNode, number, () => void]> = [
      [
        <MemoryRouter key="sumit" initialEntries={["/review"]}>
          <SumitConnectDemo />
        </MemoryRouter>,
        SUMIT_DEMO_MS,
        () => {
          expect(visibleText()).toContain("מחובר");
          expect(visibleText()).toContain("12");
        },
      ],
      [
        <JevSwitchDemo key="jev" />,
        JEV_DEMO_MS,
        () => {
          const text = document.querySelector(".ui-setup-demo")?.textContent ?? "";
          expect(text).toContain("פרויקט לדוגמה");
          expect(text).toContain("קטגוריה לדוגמה");
        },
      ],
      [
        <ProjectsDemo key="projects" />,
        PROJECTS_DEMO_MS,
        () => {
          expect(visibleText()).toContain("מוסתרות");
          expect(document.querySelector(".ui-setup-demo")?.textContent ?? "").not.toContain("פרסום");
        },
      ],
      [
        <FirstApprovalDemo key="approval" />,
        APPROVAL_DEMO_MS,
        () => {
          expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
        },
      ],
      [
        <IosInstallDemo key="ios" />,
        IOS_DEMO_MS,
        () => {
          expect(visibleText()).toContain("Flow");
          expect(visibleText()).not.toContain("פתיחה כאפליקציה");
        },
      ],
      [
        <AndroidInstallDemo key="android" />,
        ANDROID_DEMO_MS,
        () => {
          expect(visibleText()).toContain("Flow");
          expect(visibleText()).not.toContain("התקנה");
        },
      ],
    ];
    for (const [node, duration, rest] of demos) {
      const view = render(node);
      const go = clock();
      go(duration - 100);
      expect(pointerOpacity()).toBe(0);
      expect(screen.queryByRole("button", { name: "שוב" })).not.toBeInTheDocument();
      rest();
      go(duration + 50);
      expect(pointerOpacity()).toBe(0);
      expect(screen.getByRole("button", { name: "שוב" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("reacts 150ms after each press", () => {
    vi.useFakeTimers();
    const go = clock();
    const before = POINTER_REACT_MS - 40;
    const after = POINTER_REACT_MS + 80;

    const sumit = render(
      <MemoryRouter initialEntries={["/review"]}>
        <SumitConnectDemo />
      </MemoryRouter>,
    );
    const keyTap = SUMIT_POINTER.taps[0] ?? 0;
    const connectTap = SUMIT_POINTER.taps[1] ?? 0;
    go(keyTap + before);
    expect(inputValue("מספר חברה")).toBe("");
    go(keyTap + after);
    expect(inputValue("מספר חברה")).toBe("1001");
    expect(inputValue("מפתח API")).toBe("demo");
    go(connectTap + before);
    expect(document.querySelector("[data-tap='connect']")).not.toHaveAttribute("aria-busy", "true");
    go(connectTap + after);
    expect(document.querySelector("[data-tap='connect']")).toHaveAttribute("aria-busy", "true");
    sumit.unmount();

    const jev = render(<JevSwitchDemo />);
    const switchTap = JEV_POINTER.taps[0] ?? 0;
    const jevGo = clock();
    jevGo(switchTap + before);
    expect(document.querySelector(".ui-setup-demo [role='switch']")).not.toBeChecked();
    jevGo(switchTap + after);
    expect(document.querySelector(".ui-setup-demo [role='switch']")).toBeChecked();
    jev.unmount();

    const projects = render(<ProjectsDemo />);
    const chipTap = PROJECTS_POINTER.taps[0] ?? 0;
    const projectsGo = clock();
    projectsGo(chipTap + before);
    const chipBefore = document.querySelector("[data-tap='chip']");
    expect(chipBefore).toBeInstanceOf(HTMLElement);
    if (!(chipBefore instanceof HTMLElement)) throw new Error("missing chip");
    expect(Number(chipBefore.style.getPropertyValue("--setup-leave"))).toBe(0);
    projectsGo(chipTap + after);
    const chip = document.querySelector("[data-tap='chip']");
    expect(chip).toBeInstanceOf(HTMLElement);
    if (!(chip instanceof HTMLElement)) throw new Error("missing chip");
    expect(Number(chip.style.getPropertyValue("--setup-leave"))).toBeGreaterThan(0);
    projects.unmount();

    const approval = render(<FirstApprovalDemo />);
    const approveTap = APPROVAL_POINTER.taps[0] ?? 0;
    const approvalGo = clock();
    approvalGo(approveTap + before);
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("12");
    approvalGo(approveTap + after);
    expect(document.querySelector("[data-demo-count]")?.textContent).toBe("11");
    approval.unmount();

    const ios = render(<IosInstallDemo />);
    const iosGo = clock();
    const more = IOS_POINTER.taps[0] ?? 0;
    const share = IOS_POINTER.taps[1] ?? 0;
    const addHome = IOS_POINTER.taps[2] ?? 0;
    const add = IOS_POINTER.taps[3] ?? 0;
    iosGo(more + before);
    expect(visibleText()).not.toContain("שיתוף");
    iosGo(more + after);
    expect(visibleText()).toContain("שיתוף");
    expect(visibleText()).not.toContain("הוספה למסך הבית");
    iosGo(share + before);
    expect(visibleText()).not.toContain("הוספה למסך הבית");
    iosGo(share + after);
    expect(visibleText()).toContain("הוספה למסך הבית");
    iosGo(addHome + before);
    expect(visibleText()).not.toContain("פתיחה כאפליקציה");
    iosGo(addHome + after);
    expect(visibleText()).toContain("פתיחה כאפליקציה");
    iosGo(add + before);
    expect(visibleText()).not.toContain("Flow");
    iosGo(add + after);
    expect(visibleText()).toContain("Flow");
    ios.unmount();

    const android = render(<AndroidInstallDemo />);
    const androidGo = clock();
    const installTap = ANDROID_POINTER.taps[0] ?? 0;
    const confirmTap = ANDROID_POINTER.taps[1] ?? 0;
    androidGo(installTap + before);
    expect(visibleText()).not.toContain("להתקין את Flow?");
    androidGo(installTap + after);
    expect(visibleText()).toContain("להתקין את Flow?");
    androidGo(confirmTap + before);
    expect(visibleText()).toContain("להתקין את Flow?");
    androidGo(confirmTap + after);
    expect(visibleText()).toContain("Flow");
    expect(visibleText()).not.toContain("התקנה");
    android.unmount();
  });
});
