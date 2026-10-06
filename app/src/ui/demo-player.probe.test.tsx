import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DemoPlayer } from "./demo-player";

const observers: { fire: (v: boolean) => void; disconnect: () => void }[] = [];

function stubIO() {
  class FakeObserver {
    cb: IntersectionObserverCallback;
    disconnect = vi.fn();
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    fire(v: boolean) {
      const t = document.querySelector(".ui-demo");
      if (t) this.cb([{ isIntersecting: v, target: t } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
}

function progress() {
  const demo = document.querySelector(".ui-demo");
  if (!(demo instanceof HTMLElement)) throw new Error("missing demo");
  return Number(demo.style.getPropertyValue("--demo-progress"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  observers.length = 0;
});

it("pauses when scrolled off screen mid-play", () => {
  vi.useFakeTimers();
  stubIO();
  render(
    <DemoPlayer alt="הדגמה" durationMs={4000}>
      <span>x</span>
    </DemoPlayer>,
  );
  const watcher = observers[0];
  if (!watcher) throw new Error("missing observer");
  act(() => {
    watcher.fire(true);
    vi.advanceTimersByTime(1000);
  });
  act(() => {
    watcher.fire(false);
  });
  const p = progress();
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(progress()).toBe(p);
  act(() => {
    watcher.fire(true);
    vi.advanceTimersByTime(4000);
  });
  expect(progress()).toBe(1);
});

it("stops the clock and listeners on unmount", () => {
  vi.useFakeTimers();
  stubIO();
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const off = vi.spyOn(document, "removeEventListener");
  const view = render(
    <DemoPlayer alt="הדגמה" durationMs={4000}>
      <span>x</span>
    </DemoPlayer>,
  );
  const watcher = observers[0];
  if (!watcher) throw new Error("missing observer");
  act(() => {
    watcher.fire(true);
    vi.advanceTimersByTime(500);
  });
  view.unmount();
  expect(cancel).toHaveBeenCalled();
  expect(off).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  expect(watcher.disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not restart on resize", () => {
  vi.useFakeTimers();
  stubIO();
  render(
    <DemoPlayer alt="הדגמה" durationMs={4000}>
      <span>x</span>
    </DemoPlayer>,
  );
  const watcher = observers[0];
  if (!watcher) throw new Error("missing observer");
  act(() => {
    watcher.fire(true);
    vi.advanceTimersByTime(5000);
  });
  expect(progress()).toBe(1);
  act(() => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
  });
  expect(progress()).toBe(1);
  expect(document.querySelector(".ui-demo")).toHaveAttribute("data-demo-state", "settled");
});
