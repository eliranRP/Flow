import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Splash, SPLASH_END_MS, SPLASH_FADE_MS, SPLASH_REDUCED_HOLD_MS, SplashMark } from "./splash";

function reducedMotion(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: on && query.includes("reduced"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Splash (FLOW-1277)", () => {
  it("is decorative: aria-hidden, with nothing focusable in it", () => {
    const { container } = render(<Splash onDone={() => undefined} />);
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
  });

  it("does not move focus", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    render(<Splash onDone={() => undefined} />);
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("plays the whole timeline, then fades out and is done", () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    const overlay = container.firstElementChild as HTMLElement;
    act(() => void vi.advanceTimersByTime(SPLASH_END_MS - 1));
    expect(overlay.hasAttribute("data-leaving")).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(overlay.hasAttribute("data-leaving")).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a tap anywhere skips it with a quick fade", () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.pointerDown(container.firstElementChild as HTMLElement);
    expect((container.firstElementChild as HTMLElement).hasAttribute("data-leaving")).toBe(true);
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(SPLASH_END_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a key skips it too", () => {
    const onDone = vi.fn();
    render(<Splash onDone={onDone} />);
    fireEvent.keyDown(window, { key: "Tab" });
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("under reduced motion holds the finished icon about 400ms, then fades out", () => {
    reducedMotion(true);
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(SPLASH_REDUCED_HOLD_MS - 1));
    expect((container.firstElementChild as HTMLElement).hasAttribute("data-leaving")).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect((container.firstElementChild as HTMLElement).hasAttribute("data-leaving")).toBe(true);
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops its timer and key listener when it unmounts", () => {
    const onDone = vi.fn();
    const { unmount } = render(<Splash onDone={onDone} />);
    unmount();
    fireEvent.keyDown(window, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(SPLASH_END_MS + SPLASH_FADE_MS));
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("SplashMark", () => {
  it("draws the tile, the liquid, the F and the wordmark", () => {
    const { container, getByText } = render(<SplashMark />);
    expect(container.querySelectorAll("svg path.ui-splash-wave")).toHaveLength(2);
    expect(container.querySelectorAll("svg path.ui-splash-f, svg path.ui-splash-f-lit")).toHaveLength(2);
    expect(getByText("Flow")).toBeTruthy();
  });

  it("freezes at a point of the timeline for a story", () => {
    const { container } = render(<SplashMark at={1200} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.hasAttribute("data-frozen")).toBe(true);
    expect(stage.style.getPropertyValue("--splash-at")).toBe("1200ms");
  });

  it("gives two marks on one page their own clip and mask ids", () => {
    const { container } = render(<><SplashMark /><SplashMark /></>);
    const ids = [...container.querySelectorAll("clipPath, mask")].map((node) => node.id);
    expect(new Set(ids).size).toBe(4);
  });
});
