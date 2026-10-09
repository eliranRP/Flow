import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeyboardInset } from "./keyboard-inset";

type ViewportListener = () => void;

class StubVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
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
    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.scale = 1;
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
  function mountWithViewport(ui = <KeyboardHarness />) {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    return render(ui);
  }

  it("keeps the keyboard open when iOS pans the visual viewport (offsetTop) with the keyboard up", () => {
    mountWithViewport();
    viewport.height = 500;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBe("open");
    viewport.offsetTop = 300;
    act(() => { viewport.emit("scroll"); });
    expect(document.documentElement.dataset.kb).toBe("open");
    expect(document.documentElement.style.getPropertyValue("--kb")).toBe("0px");
  });

  it("does not treat pinch-zoom as an open keyboard", () => {
    mountWithViewport();
    viewport.scale = 2;
    viewport.height = 400;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });

  it("ignores small viewport changes such as the URL bar", () => {
    mountWithViewport();
    viewport.height = 760;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });

  it("does not scroll the field on iOS, where Vaul already does", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    mountWithViewport(
      <div className="ui-sheet-body">
        <KeyboardHarness />
        <input data-testid="ios-field" />
      </div>,
    );
    document.querySelector<HTMLInputElement>("[data-testid=ios-field]")?.focus();
    viewport.height = 500;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBe("open");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  function nextFrame() {
    return act(async () => { await new Promise((resolve) => requestAnimationFrame(() => { resolve(null); })); });
  }

  it("detects the keyboard when the layout viewport shrinks with it", () => {
    mountWithViewport(
      <>
        <KeyboardHarness />
        <input data-testid="shrink-field" />
      </>,
    );
    document.querySelector<HTMLInputElement>("[data-testid=shrink-field]")?.focus();
    // A browser that ignores interactive-widget resizes the layout viewport too.
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    viewport.height = 500;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBe("open");
    expect(document.documentElement.style.getPropertyValue("--kb")).toBe("0px");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    viewport.height = 800;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });

  it("a shorter window with no field focused is not a keyboard", () => {
    mountWithViewport();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    viewport.height = 500;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });

  it("takes a new full height after a rotation", () => {
    mountWithViewport(
      <>
        <KeyboardHarness />
        <input data-testid="turn-field" />
      </>,
    );
    document.querySelector<HTMLInputElement>("[data-testid=turn-field]")?.focus();
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width + 200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    viewport.height = 400;
    try {
      act(() => { viewport.emit("resize"); });
      expect(document.documentElement.dataset.kb).toBeUndefined();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });

  it("drops a drawer lift Vaul writes again after the keyboard has closed", async () => {
    mountWithViewport(
      <>
        <KeyboardHarness />
        <div data-vaul-drawer="" data-testid="drawer" />
      </>,
    );
    const drawer = document.querySelector<HTMLElement>("[data-testid=drawer]");
    // Vaul's listener runs after ours and lifts the drawer by the keyboard it last measured.
    const vaul = () => { if (drawer) drawer.style.bottom = `${String(800 - viewport.height)}px`; };
    viewport.addEventListener("resize", vaul);
    for (const height of [700, 550, 500]) {
      viewport.height = height;
      act(() => { viewport.emit("resize"); });
    }
    expect(document.documentElement.dataset.kb).toBe("open");
    await nextFrame();
    expect(drawer?.style.bottom).toBe("300px");
    // Closing in steps: at 700 the keyboard reads closed while Vaul still writes 100px.
    viewport.height = 700;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBeUndefined();
    await nextFrame();
    expect(drawer?.style.bottom).toBe("0px");
    viewport.removeEventListener("resize", vaul);
  });

  it("removes its listeners and resets the root on unmount", () => {
    const view = mountWithViewport();
    viewport.height = 500;
    act(() => { viewport.emit("resize"); });
    expect(document.documentElement.dataset.kb).toBe("open");
    view.unmount();
    expect(document.documentElement.dataset.kb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--vvh")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--kb")).toBe("");
    viewport.height = 400;
    act(() => {
      viewport.emit("resize");
      viewport.emit("scroll");
    });
    expect(document.documentElement.dataset.kb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--vvh")).toBe("");
  });
});
