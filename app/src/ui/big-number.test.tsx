import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BigNumber, formatAmount, heroStepClass, heroTypeClass } from "./big-number";
import { expectRtl } from "./test-support";

describe("BigNumber", () => {
  it("shows whole shekels before VAT, and agorot only on detail", () => {
    expectRtl();
    expect(formatAmount(-7630000n)).toBe("−₪76,300");
    expect(formatAmount(10050n)).toBe("₪100");
    expect(formatAmount(10051n)).toBe("₪101");
    expect(formatAmount(10050n, "detail")).toBe("₪100.50");
    render(<BigNumber agorot={-1000000n} loss />);
    const amount = screen.getByText("−₪10,000");
    expect(amount).toHaveAttribute("dir", "ltr");
    expect(amount).toHaveClass("ui-loss");
  });

  it("steps a hero figure down from state, without writing the class onto the node first", () => {
    expect(heroTypeClass("hero", false)).toBe("t-hero");
    expect(heroTypeClass("hero", true)).toBe("t-display");
    expect(heroStepClass("display", 0)).toBe("t-display");
    expect(heroStepClass("display", 2)).toBe("t-title-2");
    expect(heroStepClass("display", 9)).toBe("t-title-3");
    expect(heroStepClass("list", 3)).toBe("t-title-3");
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    if (!rect) throw new Error("getBoundingClientRect is missing");
    const original = rect.value as (this: Element) => DOMRect;
    const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute("aria-hidden") === "true") {
        const hero = this.className.includes("t-hero");
        return DOMRect.fromRect({ width: hero ? 480 : 120, height: 44 });
      }
      return original.call(this);
    };
    Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 200 });
    try {
      render(
        <div className="ui-band-hero">
          <BigNumber agorot={1_234_567_800n} size="hero" />
        </div>,
      );
      const shown = screen.getByText("₪12,345,678", { selector: "bdi[dir=ltr]" });
      expect(shown).toHaveClass("t-display");
      expect(shown).not.toHaveClass("t-hero");
    } finally {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
      if (client) Object.defineProperty(Element.prototype, "clientWidth", client);
      else Reflect.deleteProperty(Element.prototype, "clientWidth");
    }
  });

  it("steps a detail figure down from display to the largest size that fits the padded block", () => {
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    if (!rect) throw new Error("getBoundingClientRect is missing");
    const original = rect.value as (this: Element) => DOMRect;
    const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    const widths: Record<string, number> = { "t-hero": 400, "t-display": 300, "t-title-1": 240, "t-title-2": 190, "t-title-3": 170 };
    const probed: string[] = [];
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute("aria-hidden") === "true") {
        const type = this.className.split(" ").find((name) => name in widths) ?? "t-hero";
        probed.push(type);
        return DOMRect.fromRect({ width: widths[type] ?? 0, height: 40 });
      }
      return original.call(this);
    };
    // The flex line around the figure is as narrow as the figure; the padded block is what counts.
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get(this: Element) {
        return this.classList.contains("ui-line") ? 10 : 200;
      },
    });
    try {
      render(
        <div className="ui-page-pad">
          <span className="ui-line">
            <BigNumber agorot={-9_999_999_999n} presentation="detail" direction="expense" size="display" />
          </span>
        </div>,
      );
      const shown = screen.getByText("−₪99,999,999.99", { selector: "bdi[dir=ltr]" });
      expect(shown).toHaveClass("t-title-2");
      expect(shown).not.toHaveClass("t-display");
      expect(probed).not.toContain("t-hero");
    } finally {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
      if (client) Object.defineProperty(Element.prototype, "clientWidth", client);
      else Reflect.deleteProperty(Element.prototype, "clientWidth");
    }
  });

  it("caches ancestor padding and does not read it again on resize", async () => {
    let calls = 0;
    const style = Object.getOwnPropertyDescriptor(window, "getComputedStyle");
    const original = window.getComputedStyle.bind(window);
    window.getComputedStyle = (element: Element, pseudo?: string | null) => {
      calls += 1;
      return original(element, pseudo);
    };
    let notify: ResizeObserverCallback = () => undefined;
    let observed = 0;
    const Observer = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe() {
        observed += 1;
      }
      unobserve() {}
      disconnect() {}
    };
    try {
      render(
        <div>
          <div className="ui-band-hero">
            <BigNumber agorot={1_234_567_800n} size="hero" />
          </div>
        </div>,
      );
      await act(async () => { await Promise.resolve(); });
      const afterMeasure = calls;
      expect(observed).toBeGreaterThan(1);
      notify([], {} as ResizeObserver);
      expect(calls).toBe(afterMeasure);
    } finally {
      if (style) Object.defineProperty(window, "getComputedStyle", style);
      else window.getComputedStyle = original;
      globalThis.ResizeObserver = Observer;
    }
  });

  it("draws income green only when the figure shows no minus (decision 0113)", () => {
    render(
      <>
        <BigNumber agorot={250000n} direction="income" income />
        <BigNumber agorot={-40000n} income />
        <BigNumber agorot={90000n} />
      </>,
    );
    expect(screen.getByText("₪2,500")).toHaveClass("ui-income");
    expect(screen.getByText("₪2,500").textContent).not.toContain("+");
    const negative = screen.getByText("−₪400");
    expect(negative).not.toHaveClass("ui-income");
    expect(screen.getByText("₪900")).not.toHaveClass("ui-income");
  });

  it("draws detail agorot in a smaller span and keeps the same text", () => {
    const { container } = render(
      <>
        <BigNumber agorot={1200050n} presentation="detail" />
        <BigNumber agorot={1200050n} />
        <BigNumber agorot={1200000n} presentation="detail" />
      </>,
    );
    const [detail, summary, whole] = Array.from(container.querySelectorAll("bdi"));
    expect(detail?.textContent).toBe("₪12,000.50");
    expect(detail?.querySelector(".ui-num-cents")?.textContent).toBe(".50");
    expect(summary?.textContent).toBe("₪12,000");
    expect(summary?.querySelector(".ui-num-cents")).toBeNull();
    expect(whole?.textContent).toBe("₪12,000");
    expect(whole?.querySelector(".ui-num-cents")).toBeNull();
  });

  it("uses the amount style for list figures", () => {
    render(<BigNumber agorot={150000n} size="list" />);
    expect(screen.getByText("₪1,500")).toHaveClass("t-amount");
  });
});
