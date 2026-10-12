import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Amount, formatAmount, heroStepClass } from "./amount";
import { expectRtl } from "./test-support";

describe("Amount", () => {
  it("shows whole shekels before VAT, and agorot only on detail", () => {
    expectRtl();
    expect(formatAmount(-7630000n)).toBe("−₪76,300");
    expect(formatAmount(10050n)).toBe("₪100");
    expect(formatAmount(10051n)).toBe("₪101");
    expect(formatAmount(10050n, "detail")).toBe("₪100.50");
    render(<Amount agorot={-1000000n} loss />);
    const amount = screen.getByText("−₪10,000");
    expect(amount).toHaveAttribute("dir", "ltr");
    expect(amount).toHaveClass("ui-loss");
  });

  it("steps a hero figure down from state, without writing the class onto the node first", () => {
    expect(heroStepClass("hero", 0)).toBe("t-hero");
    expect(heroStepClass("hero", 1)).toBe("t-display");
    expect(heroStepClass("display", 0)).toBe("t-display");
    expect(heroStepClass("display", 2)).toBe("t-title-2");
    expect(heroStepClass("display", 9)).toBe("t-title-3");
    expect(heroStepClass("list", 3)).toBe("t-amount");
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
          <Amount agorot={1_234_567_800n} size="hero" />
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
            <Amount agorot={-9_999_999_999n} presentation="detail" direction="expense" size="display" />
          </span>
        </div>,
      );
      // The agorot sit in their own smaller span, so match the whole figure by its text content.
      const shown = screen.getByText((_, el) => el?.matches("bdi[dir=ltr]") === true && el.textContent === "−₪99,999,999.99");
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
            <Amount agorot={1_234_567_800n} size="hero" />
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

  it("draws income green only when the figure shows no minus (decision 0120)", () => {
    render(
      <>
        <Amount agorot={250000n} direction="income" income />
        <Amount agorot={-40000n} income />
        <Amount agorot={90000n} />
      </>,
    );
    expect(screen.getByText("+₪2,500")).toHaveClass("ui-income");
    const negative = screen.getByText("−₪400");
    expect(negative).not.toHaveClass("ui-income");
    expect(screen.getByText("₪900")).not.toHaveClass("ui-income");
  });

  it("draws a plus inside the ltr bdi on every income figure (decision 0181)", () => {
    render(
      <>
        <Amount agorot={250000n} direction="income" income />
        <Amount agorot={250000n} income />
        <Amount agorot={250000n} income presentation="detail" size="list" />
      </>,
    );
    const figures = screen.getAllByText((_, el) => el?.matches("bdi[dir=ltr]") === true && el.textContent.startsWith("+"));
    expect(figures).toHaveLength(3);
    expect(figures[0]?.textContent).toBe("+₪2,500");
    expect(figures[1]?.textContent).toBe("+₪2,500");
    expect(figures[2]?.textContent).toBe("+₪2,500");
  });

  it("does not paint a summary income that rounds to ₪0 green", () => {
    render(<Amount agorot={40n} income direction="income" />);
    const zero = screen.getByText("₪0");
    expect(zero).not.toHaveClass("ui-income");
  });

  it("starts an expense and a loss with the Unicode minus, and never draws a sign on zero", () => {
    const { container } = render(
      <>
        <Amount agorot={100000n} direction="expense" />
        <Amount agorot={-100000n} loss />
        <Amount agorot={0n} income />
        <Amount agorot={0n} direction="income" income />
      </>,
    );
    const [expense, loss, zeroIncome, zeroDirected] = Array.from(container.querySelectorAll("bdi"));
    expect(expense?.textContent.startsWith("−")).toBe(true);
    expect(loss?.textContent.startsWith("−")).toBe(true);
    expect(zeroIncome?.textContent).toBe("₪0");
    expect(zeroIncome).not.toHaveClass("ui-income");
    expect(zeroDirected?.textContent).toBe("₪0");
  });

  it("draws detail agorot in a smaller span and keeps the same text", () => {
    const { container } = render(
      <>
        <Amount agorot={1200050n} presentation="detail" />
        <Amount agorot={1200050n} />
        <Amount agorot={1200000n} presentation="detail" />
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
    render(<Amount agorot={150000n} size="list" />);
    expect(screen.getByText("₪1,500")).toHaveClass("t-amount");
  });

  it("draws a list figure's cents as a small raised span", () => {
    const { container } = render(<Amount agorot={1234_50n} size="list" cents="always" />);
    const cents = container.querySelector("bdi .ui-num-cents");
    expect(cents?.textContent).toBe(".50");
    expect(container.querySelector("bdi")).toHaveClass("t-amount");
  });
});
