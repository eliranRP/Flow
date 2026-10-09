import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwipeRemove, swipeRemoves } from "./swipe-remove";

function frame(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".ui-sremove");
  if (!node) throw new Error("no swipe frame");
  node.getBoundingClientRect = () => ({ width: 300, height: 80, top: 100, left: 37, right: 337, bottom: 180, x: 37, y: 100, toJSON: () => ({}) });
  return node;
}

function row(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".ui-sremove-row");
  if (!node) throw new Error("no swipe row");
  return node;
}

function swipe(target: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
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

beforeEach(() => {
  document.documentElement.dir = "rtl";
});

afterEach(() => {
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function Part({ onRemove, onPick = () => undefined, disabled = false }: { onRemove: () => void; onPick?: () => void; disabled?: boolean }) {
  return (
    <SwipeRemove onRemove={onRemove} disabled={disabled}>
      <button type="button" onClick={onPick}>חומרים</button>
      <input aria-label="אחוז" />
    </SwipeRemove>
  );
}

describe("swipeRemoves (FLOW-325 §10)", () => {
  it("removes on a move toward the start side past 30% of the width, or on a flick", () => {
    expect(swipeRemoves(90, 2000, 300, true)).toBe(true);
    expect(swipeRemoves(80, 2000, 300, true)).toBe(false);
    expect(swipeRemoves(60, 100, 300, true)).toBe(true);
    expect(swipeRemoves(-90, 2000, 300, true)).toBe(false);
    expect(swipeRemoves(-90, 2000, 300, false)).toBe(true);
  });
});

describe("SwipeRemove", () => {
  it("removes the row after it slides out toward the start side", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} />);
    swipe(frame(), { x: 100, y: 130 }, { x: 260, y: 134 });
    expect(row().style.transform).toBe("translateX(300px)");
    expect(onRemove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("follows the finger over הסרה and settles back on a short move", () => {
    setReducedMotion(false);
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} />);
    const node = frame();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 130 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 160, clientY: 132 }] });
    expect(row().style.transform).toBe("translateX(60px)");
    expect(node).toHaveAttribute("data-drag");
    // The finger comes back before it lifts: 20px is under a flick's 30px, whatever the timing.
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 120, clientY: 132 }] });
    expect(row().style.transform).toBe("");
    expect(node).not.toHaveAttribute("data-drag");
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("only gives a little toward the end side, and never removes there", () => {
    setReducedMotion(false);
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} />);
    const node = frame();
    fireEvent.touchStart(node, { touches: [{ clientX: 260, clientY: 130 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 60, clientY: 130 }] });
    expect(row().style.transform).toBe("translateX(-32px)");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 60, clientY: 130 }] });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("leaves a vertical move, a start at the screen edge and a start in a field alone", () => {
    setReducedMotion(true);
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} />);
    swipe(frame(), { x: 100, y: 130 }, { x: 130, y: 260 });
    swipe(frame(), { x: window.innerWidth - 10, y: 130 }, { x: window.innerWidth - 10 + 200, y: 130 });
    swipe(screen.getByRole("textbox", { name: "אחוז" }), { x: 100, y: 130 }, { x: 260, y: 130 });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("removes on release with reduced motion, and the row never moves", () => {
    setReducedMotion(true);
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} />);
    const node = frame();
    fireEvent.touchStart(node, { touches: [{ clientX: 100, clientY: 130 }] });
    fireEvent.touchMove(node, { touches: [{ clientX: 260, clientY: 130 }] });
    expect(row().style.transform).toBe("");
    fireEvent.touchEnd(node, { touches: [], changedTouches: [{ clientX: 260, clientY: 130 }] });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    setReducedMotion(true);
    const onRemove = vi.fn();
    render(<Part onRemove={onRemove} disabled />);
    swipe(frame(), { x: 100, y: 130 }, { x: 260, y: 130 });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("swallows the click a drag ends in, but not the next tap", () => {
    setReducedMotion(false);
    const onPick = vi.fn();
    render(<Part onRemove={vi.fn()} onPick={onPick} />);
    const pick = screen.getByRole("button", { name: "חומרים" });
    swipe(pick, { x: 100, y: 130 }, { x: 140, y: 131 });
    fireEvent.click(pick);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.touchStart(pick, { touches: [{ clientX: 100, clientY: 130 }] });
    fireEvent.touchEnd(pick, { touches: [], changedTouches: [{ clientX: 100, clientY: 130 }] });
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("keeps the delete mark out of the accessibility tree", () => {
    render(<Part onRemove={vi.fn()} />);
    expect(screen.queryByText("הסרה")?.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
