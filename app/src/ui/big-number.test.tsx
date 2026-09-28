import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BigNumber, formatAmount } from "./big-number";
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
});
