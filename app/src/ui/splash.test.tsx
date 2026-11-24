import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Splash, SPLASH_END_MS, SPLASH_FADE_MS, SPLASH_FAILSAFE_MS, SPLASH_MIN_MS, SPLASH_REDUCED_HOLD_MS, SplashMark } from "./splash";
import { watchHomeReady } from "./splash-ready";

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
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  document.body.replaceChildren();
  window.history.pushState({}, "", "/");
});

function ms(n: number) {
  act(() => {
    vi.advanceTimersByTime(n);
  });
}
const isLeaving = (container: HTMLElement) => (container.firstElementChild as HTMLElement).hasAttribute("data-leaving");
async function flushObserver() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Home's first figures arriving: the figures marker inside the band, with no skeleton. */
async function drawFigures() {
  const band = document.createElement("div");
  band.className = "ui-band-body";
  band.innerHTML = '<span class="ui-num">1,234</span>';
  document.body.append(band);
  await flushObserver();
}

function stubAnimations(updatePlaybackRate: (rate: number) => void) {
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { value: () => [{ updatePlaybackRate }], configurable: true });
}

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

  it("with no data it holds the finished icon to the failsafe, then fades out and is gone", () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(SPLASH_END_MS + 100);
    expect(isLeaving(container)).toBe(false);
    ms(SPLASH_FAILSAFE_MS - SPLASH_FADE_MS - SPLASH_END_MS - 100 - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a tap anywhere skips it with a quick fade", () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(300);
    fireEvent.pointerDown(container.firstElementChild as HTMLElement);
    expect(isLeaving(container)).toBe(true);
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    ms(SPLASH_FAILSAFE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a key skips it too", () => {
    const onDone = vi.fn();
    render(<Splash onDone={onDone} />);
    fireEvent.keyDown(window, { key: "Tab" });
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("under reduced motion holds the finished icon about 400ms, then fades out", () => {
    reducedMotion(true);
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(SPLASH_REDUCED_HOLD_MS - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops its timer and key listener when it unmounts", () => {
    const onDone = vi.fn();
    const { unmount } = render(<Splash onDone={onDone} />);
    unmount();
    fireEvent.keyDown(window, { key: "Enter" });
    ms(SPLASH_FAILSAFE_MS + SPLASH_FADE_MS);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("Splash ends when Home's figures are drawn (FLOW-1303)", () => {
  it("ends no earlier than 800ms when the data is ready at 300ms, then fades", async () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(300);
    await drawFigures();
    ms(SPLASH_MIN_MS - 300 - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends soon after the data when it is ready at 1,500ms", async () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(1500);
    await drawFigures();
    ms(399);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(performance.now()).toBeLessThan(SPLASH_END_MS);
  });

  it("brings the rest of the fill to its end quickly instead of cutting it off", async () => {
    const rate = vi.fn();
    stubAnimations(rate);
    render(<Splash onDone={() => undefined} />);
    ms(300);
    await drawFigures();
    // 2,400ms of animation left, played in the 500ms up to the minimum.
    expect(rate).toHaveBeenCalledTimes(1);
    expect(rate.mock.calls[0]?.[0]).toBeCloseTo((SPLASH_END_MS - 300) / (SPLASH_MIN_MS - 300), 5);
  });

  it("does not speed anything up once the animation is at its end", async () => {
    const rate = vi.fn();
    stubAnimations(rate);
    const { container } = render(<Splash onDone={() => undefined} />);
    ms(SPLASH_END_MS + 50);
    await drawFigures();
    expect(rate).not.toHaveBeenCalled();
    ms(0);
    expect(isLeaving(container)).toBe(true);
  });

  it("ends at 3s when data never comes", () => {
    const onDone = vi.fn();
    render(<Splash onDone={onDone} />);
    ms(SPLASH_FAILSAFE_MS - SPLASH_FADE_MS);
    expect(onDone).not.toHaveBeenCalled();
    ms(SPLASH_FADE_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    ms(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("waits while a skeleton is still up, and ends when it goes", async () => {
    const { container } = render(<Splash onDone={() => undefined} />);
    const skeleton = document.createElement("div");
    skeleton.className = "ui-skeleton-bar";
    document.body.append(skeleton);
    ms(1000);
    await drawFigures();
    ms(1000);
    expect(isLeaving(container)).toBe(false);
    skeleton.remove();
    await flushObserver();
    ms(SPLASH_END_MS);
    expect(isLeaving(container)).toBe(true);
  });

  it("a signed-out start (the login screen) ends it at the minimum", () => {
    window.history.pushState({}, "", "/sign-in");
    const { container } = render(<Splash onDone={() => undefined} />);
    ms(SPLASH_MIN_MS - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
  });

  it("a move to the login screen while it plays ends it too", async () => {
    const { container } = render(<Splash onDone={() => undefined} />);
    ms(100);
    window.history.pushState({}, "", "/sign-in");
    document.body.append(document.createElement("main"));
    await flushObserver();
    ms(SPLASH_MIN_MS - 100);
    expect(isLeaving(container)).toBe(true);
  });

  it("an error screen ends it at the minimum", async () => {
    const { container } = render(<Splash onDone={() => undefined} />);
    const failed = document.createElement("div");
    failed.className = "ui-band-body ui-band-failed";
    document.body.append(failed);
    await flushObserver();
    ms(SPLASH_MIN_MS - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
  });

  it("a tap still skips it before the data arrives, and the late data does nothing more", async () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    ms(200);
    fireEvent.pointerDown(container.firstElementChild as HTMLElement);
    await drawFigures();
    ms(SPLASH_FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    ms(SPLASH_FAILSAFE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps reduced motion: a 400ms hold of the finished icon, with no watching for data", () => {
    reducedMotion(true);
    const watch = vi.fn(watchHomeReady);
    const { container } = render(<Splash onDone={() => undefined} watch={watch} />);
    expect(watch).not.toHaveBeenCalled();
    ms(SPLASH_REDUCED_HOLD_MS - 1);
    expect(isLeaving(container)).toBe(false);
    ms(1);
    expect(isLeaving(container)).toBe(true);
  });

  it("stops watching the page when it ends: by a tap, by the failsafe, or by unmounting", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const first = render(<Splash onDone={() => undefined} />);
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.pointerDown(first.container.firstElementChild as HTMLElement);
    expect(disconnect).toHaveBeenCalledTimes(1);
    first.unmount();

    disconnect.mockClear();
    const second = render(<Splash onDone={() => undefined} />);
    second.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);

    disconnect.mockClear();
    const third = render(<Splash onDone={() => undefined} />);
    ms(SPLASH_FAILSAFE_MS);
    expect(disconnect).toHaveBeenCalledTimes(1);
    third.unmount();
  });

  it("stops watching as soon as the data is ready: later changes never reach it", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    render(<Splash onDone={() => undefined} />);
    await drawFigures();
    expect(disconnect).toHaveBeenCalled();
    const calls = disconnect.mock.calls.length;
    document.body.append(document.createElement("div"));
    await flushObserver();
    expect(disconnect.mock.calls.length).toBe(calls);
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
