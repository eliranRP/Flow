import type { CashCurrencyRow } from "@flow/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AttentionBox, ForecastRow, HomeMonthPill, SplitCard, homeMonthLabel } from "./home-parts";

// Invented figures only; amounts are agorot.
function row(net: number, profit: number): CashCurrencyRow {
  return {
    currency: "ILS",
    in_minor: 1_000_000n,
    out_minor: 1_000_000n - BigInt(net),
    net_minor: BigInt(net),
    profit_minor: BigInt(profit),
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [{ name: "שיפוץ והשבחה", amount_minor: BigInt(net - profit) }],
  };
}

const nav = { earlierKey: "2026-09", laterKey: null, onStep: vi.fn(), onOpenDrawer: vi.fn() };

describe("Home's band parts (FLOW-364)", () => {
  it("names the month pill and disables the later arrow on the current month", () => {
    render(
      <MemoryRouter>
        <HomeMonthPill monthKey="2026-10" nav={nav} />
      </MemoryRouter>,
    );
    expect(screen.getByText(homeMonthLabel("2026-10"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "חודש קודם" })).not.toHaveAttribute("aria-disabled");
  });

  it("titles the split card by the sign of the net", () => {
    const { rerender } = render(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(-94_600, 12_000)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "ממה מורכב המינוס" })).toBeInTheDocument();
    expect(screen.getByText("רוב הכסף שיצא הלך לנכסים. הפעילות השוטפת הרוויחה ₪120.")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(50_000, 80_000)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "ממה מורכב התזרים" })).toBeInTheDocument();
  });

  it("hides the split card when both parts are 0", () => {
    const { container } = render(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(0, 0)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the attention box with no rows", () => {
    const { container } = render(<AttentionBox rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the forecast by the month's name", () => {
    render(<ForecastRow monthKey="2026-10" minor={-6_810_000n} currency="ILS" />);
    expect(screen.getByText("צפי לסוף אוקטובר")).toBeInTheDocument();
  });
});
