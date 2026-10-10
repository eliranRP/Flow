import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allTime, presetPeriod, stepPeriod, windowLabel, type PeriodChoice } from "../period";
import { EDGE_PX } from "./edge-back";
import { COMMIT_RATIO, FLICK_MIN_PX, FLICK_SPEED, PeriodSwipe, inEdgeZone, swipeAxis, swipeStep } from "./period-swipe";

describe("swipe rules (FLOW-314's, decision 0150)", () => {
  it("decides nothing under 10px, then the larger axis", () => {
    expect(swipeAxis(6, 3)).toBeNull();
    expect(swipeAxis(12, 4)).toBe("x");
    expect(swipeAxis(-12, 4)).toBe("x");
    expect(swipeAxis(8, 14)).toBe("y");
    // A tie is not sideways: the page scroll wins.
    expect(swipeAxis(10, 10)).toBe("y");
  });

  it("leaves a start in either 24px edge zone alone", () => {
    expect(EDGE_PX).toBe(24);
    expect(inEdgeZone(10, 375)).toBe(true);
    expect(inEdgeZone(370, 375)).toBe(true);
    // The 24th px from either edge belongs to swipe-back (FLOW-332), as on the card.
    expect(inEdgeZone(24, 375)).toBe(true);
    expect(inEdgeZone(351, 375)).toBe(true);
    expect(inEdgeZone(25, 375)).toBe(false);
    expect(inEdgeZone(350, 375)).toBe(false);
    expect(inEdgeZone(200, 375)).toBe(false);
  });

  it("goes earlier when the finger moves right, toward the start-side arrow, and later when it moves left", () => {
    const far = 300 * COMMIT_RATIO;
    expect(swipeStep(far, 2000, 300)).toBe(-1);
    expect(swipeStep(-far, 2000, 300)).toBe(1);
  });

  it("commits past 30% of the width or on a flick, and not on a short slow move", () => {
    expect(swipeStep(80, 2000, 300)).toBe(0);
    expect(swipeStep(FLICK_MIN_PX, FLICK_MIN_PX / FLICK_SPEED, 300)).toBe(-1);
    expect(swipeStep(FLICK_MIN_PX - 1, 1, 300)).toBe(0);
    expect(swipeStep(60, 400, 300)).toBe(0);
  });
});

function Harness({ start, onStep }: { start: PeriodChoice; onStep?: (period: PeriodChoice) => void }) {
  const [period, setPeriod] = useState(start);
  return (
    <PeriodSwipe
      period={period}
      onChange={(next) => {
        onStep?.(next);
        setPeriod(next);
      }}
    >
      <p>{windowLabel(period)}</p>
    </PeriodSwipe>
  );
}

function figure(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".ui-pswipe");
  if (!node) throw new Error("no swipe box");
  node.getBoundingClientRect = () => ({ width: 300, height: 120, top: 100, left: 37, right: 337, bottom: 220, x: 37, y: 100, toJSON: () => ({}) });
  return node;
}

function swipe(node: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.touchStart(node, { touches: [{ clientX: from.x, clientY: from.y }] });
  fireEvent.touchMove(node, { touches: [{ clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 }] });
  fireEvent.touchMove(node, { touches: [{ clientX: to.x, clientY: to.y }] });
  fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: to.x, clientY: to.y }] });
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  document.body.innerHTML = "";
});

describe("PeriodSwipe", () => {
  const months3 = presetPeriod("months3");
  const earlier = stepPeriod(months3, -1);

  it("steps to the earlier window on a swipe right, then back on a swipe left", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    swipe(figure(), { x: 100, y: 160 }, { x: 260, y: 166 });
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(windowLabel(onStep.mock.calls[0]?.[0] as PeriodChoice)).toBe(windowLabel(earlier as PeriodChoice));
    expect(screen.getByText(windowLabel(earlier as PeriodChoice))).toBeInTheDocument();
    swipe(figure(), { x: 260, y: 160 }, { x: 100, y: 160 });
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(screen.getByText(windowLabel(months3))).toBeInTheDocument();
  });

  it("does not step later than the current window", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    swipe(figure(), { x: 260, y: 160 }, { x: 100, y: 160 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("does not step to a window the screen blocks (a month page's first month, FLOW-362)", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(
      <PeriodSwipe period={months3} onChange={onStep} allow={() => false}>
        <p>{windowLabel(months3)}</p>
      </PeriodSwipe>,
    );
    swipe(figure(), { x: 100, y: 160 }, { x: 260, y: 166 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("hands a mostly vertical move to the page scroll", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    swipe(figure(), { x: 100, y: 100 }, { x: 220, y: 400 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("ignores a start in the edge zone, where swipe-back (FLOW-332) starts", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    swipe(figure(), { x: window.innerWidth - 10, y: 160 }, { x: window.innerWidth - 10 - 200, y: 160 });
    swipe(figure(), { x: 10, y: 160 }, { x: 210, y: 160 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("ignores a swipe while a sheet is open", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    document.body.append(sheet);
    swipe(figure(), { x: 100, y: 160 }, { x: 260, y: 160 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("does nothing on הכול, which has no arrows either", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={allTime()} onStep={onStep} />);
    const node = figure();
    expect(node).not.toHaveAttribute("data-period-swipe");
    swipe(node, { x: 100, y: 160 }, { x: 260, y: 160 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("does not step on a short move", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    swipe(figure(), { x: 100, y: 160 }, { x: 100 + FLICK_MIN_PX - 2, y: 160 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("follows the finger, and settles back on release", () => {
    setReducedMotion(false);
    render(<Harness start={months3} />);
    const node = figure();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 160 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 160, clientY: 162 }] });
    expect(node.style.transform).toBe("translateX(30px)");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 160, clientY: 162 }] });
    expect(node.style.transform).toBe("");
  });

  it("with reduced motion, stays put while dragging and swaps the period on release", () => {
    setReducedMotion(true);
    const onStep = vi.fn();
    render(<Harness start={months3} onStep={onStep} />);
    const node = figure();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 160 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 200, clientY: 162 }] });
    expect(node.style.transform).toBe("");
    fireEvent.touchMove(node, { touches: [{ clientX: 260, clientY: 162 }] });
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 260, clientY: 162 }] });
    expect(onStep).toHaveBeenCalledTimes(1);
  });
});
