import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeyboardInset } from "./keyboard-inset";

type ViewportListener = () => void;

class StubVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  private listeners = new Map<string, Set<ViewportListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener !== "function") return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as ViewportListener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener !== "function") return;
    this.listeners.get(type)?.delete(listener as ViewportListener);
  }

  emit(type: "resize" | "scroll") {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function KeyboardHarness() {
  useKeyboardInset();
  return null;
}

describe("useKeyboardInset", () => {
  const viewport = new StubVisualViewport();
  const original = window.visualViewport;
  const scrollIntoView = vi.fn();

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: original,
    });
    delete document.documentElement.dataset.kb;
    document.documentElement.style.removeProperty("--vvh");
    document.documentElement.style.removeProperty("--kb");
    scrollIntoView.mockReset();
    vi.unstubAllGlobals();
  });

  it("sets --vvh and data-kb when the keyboard opens", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    render(<KeyboardHarness />);
    expect(document.documentElement.style.getPropertyValue("--vvh")).toBe("800px");
    expect(document.documentElement.dataset.kb).toBeUndefined();

    viewport.height = 500;
    act(() => {
      viewport.emit("resize");
    });
    expect(document.documentElement.style.getPropertyValue("--vvh")).toBe("500px");
    expect(document.documentElement.style.getPropertyValue("--kb")).toBe("300px");
    expect(document.documentElement.dataset.kb).toBe("open");

    viewport.height = 800;
    act(() => {
      viewport.emit("resize");
    });
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });

  it("scrolls a focused sheet field into view when the keyboard opens (non-iOS)", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14)" });
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    function SheetFieldHarness() {
      useKeyboardInset();
      return (
        <div className="ui-sheet-body">
          <input data-testid="field" />
        </div>
      );
    }

    render(<SheetFieldHarness />);
    const input = document.querySelector<HTMLInputElement>("[data-testid=field]");
    expect(input).not.toBeNull();
    input?.focus();
    viewport.height = 500;
    act(() => {
      viewport.emit("resize");
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
