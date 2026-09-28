import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BigNumber, formatAmount, heroTypeClass } from "./big-number";
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
});
