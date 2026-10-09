import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardSwipe, cardStep, type CardStep } from "./card-swipe";

function box(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".ui-cswipe-card");
  if (!node) throw new Error("no swipe box");
  node.getBoundingClientRect = () => ({ width: 300, height: 400, top: 100, left: 37, right: 337, bottom: 500, x: 37, y: 100, toJSON: () => ({}) });
  return node;
}

function swipe(node: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, target: Element = node) {
  fireEvent.touchStart(target, { touches: [{ clientX: from.x, clientY: from.y }] });
  fireEvent.touchMove(target, { touches: [{ clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 }] });
  fireEvent.touchMove(target, { touches: [{ clientX: to.x, clientY: to.y }] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: to.x, clientY: to.y }] });
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

function Card({ onStep, canNext = true, canPrev = true, enter = null }: { onStep: (step: CardStep) => void; canNext?: boolean; canPrev?: boolean; enter?: CardStep | null }) {
  return (
    <CardSwipe canNext={canNext} canPrev={canPrev} onStep={onStep} enter={enter}>
      <p>ספק 5</p>
      <input aria-label="שדה" />
    </CardSwipe>
  );
}

describe("cardStep (FLOW-314)", () => {
  it("opens the next card when the finger moves right and the previous one when it moves left", () => {
    expect(cardStep(90, 2000, 300)).toBe("next");
    expect(cardStep(-90, 2000, 300)).toBe("prev");
    expect(cardStep(80, 2000, 300)).toBeNull();
  });
});

describe("CardSwipe", () => {
  it("swipes right to the next card and left to the previous one", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Card onStep={onStep} />);
    swipe(box(), { x: 100, y: 300 }, { x: 260, y: 306 });
    swipe(box(), { x: 260, y: 300 }, { x: 100, y: 300 });
    expect(onStep.mock.calls).toEqual([["next"], ["prev"]]);
  });

  it("follows the finger while it moves, and settles back on release", () => {
    setReducedMotion(false);
    render(<Card onStep={vi.fn()} />);
    const node = box();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 160, clientY: 302 }] });
    expect(node.style.transform).toBe("translateX(60px)");
    expect(node).toHaveClass("ui-cswipe-drag");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 160, clientY: 302 }] });
    expect(node.style.transform).toBe("");
    expect(node).not.toHaveClass("ui-cswipe-drag");
  });

  it("does not move or step toward a list end", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Card onStep={onStep} canNext={false} />);
    const node = box();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 200, clientY: 300 }] });
    expect(node.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 260, clientY: 300 }] });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("hands a mostly vertical move to the page scroll", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Card onStep={onStep} />);
    swipe(box(), { x: 100, y: 100 }, { x: 220, y: 400 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("leaves starts at the screen edges, in a field or with a sheet open alone", () => {
    setReducedMotion(false);
    const onStep = vi.fn();
    render(<Card onStep={onStep} />);
    swipe(box(), { x: window.innerWidth - 10, y: 300 }, { x: window.innerWidth - 210, y: 300 });
    swipe(box(), { x: 10, y: 300 }, { x: 210, y: 300 });
    swipe(box(), { x: 100, y: 300 }, { x: 260, y: 300 }, screen.getByLabelText("שדה"));
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    document.body.append(sheet);
    swipe(box(), { x: 100, y: 300 }, { x: 260, y: 300 });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("with reduced motion the card stays put and swaps on release", () => {
    setReducedMotion(true);
    const onStep = vi.fn();
    render(<Card onStep={onStep} />);
    const node = box();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 200, clientY: 300 }] });
    expect(node.style.transform).toBe("");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 260, clientY: 300 }] });
    expect(onStep).toHaveBeenCalledWith("next");
  });

  it("marks the side a swiped-to card enters from, and nothing when neither side has a card", () => {
    const { rerender } = render(<Card onStep={vi.fn()} enter="next" />);
    expect(box()).toHaveAttribute("data-enter", "next");
    expect(document.querySelector(".ui-cswipe")).toHaveClass("ui-cswipe-on");
    rerender(<Card onStep={vi.fn()} canNext={false} canPrev={false} />);
    expect(box()).not.toHaveAttribute("data-enter");
    expect(document.querySelector(".ui-cswipe")).not.toHaveClass("ui-cswipe-on");
  });
});
