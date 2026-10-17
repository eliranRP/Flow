import type { PartyCharges } from "@flow/shared";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ChargeMonthBars, PartyChargesHistory } from "./related-charges";

const party = { direction: "expense" as const, id: "water", name: "Bayside Water Utility", currency: "USD" };

function charges(count: number, current = "tx-10"): PartyCharges {
  const list = Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? current : `tx-${String(10 - index)}`,
    doc_date: `2026-${String(10 - index).padStart(2, "0")}-05`,
    amount_minor: BigInt(14200 - index * 100),
    pending: false,
  }));
  return {
    transaction_id: current,
    party,
    month: "2026-10",
    month_amount_minor: 14200n,
    typical_amount_minor: 10300n,
    typical_source: "recurring",
    change_percent: 38,
    others: count - 1,
    months: [["2026-05", 9800n], ["2026-06", 10400n], ["2026-07", 0n], ["2026-08", 10900n], ["2026-09", 10300n], ["2026-10", 14200n]].map(
      ([month, amount_minor]) => ({ month: month as string, amount_minor: amount_minor as bigint }),
    ),
    charges: list,
  };
}

const change = { percent: "38%", arrow: "▲" as const, hurts: true, usual: "$103", change: "עלה ב־38%", words: "עלייה של 38% לעומת הרגיל, $103" };

describe("PartyChargesHistory on the charge page (plain, FLOW-447c)", () => {
  it("lists the three newest charges including this one, with no badge and no chevron", () => {
    const { container } = render(
      <MemoryRouter>
        <PartyChargesHistory plain data={charges(5)} onShowAll={() => undefined} change={change} />
      </MemoryRouter>,
    );
    const rows = container.querySelectorAll(".ui-charges-list li");
    expect(rows).toHaveLength(3);
    expect(screen.queryByText("השורה הזו")).toBeNull();
    expect(container.querySelector(".ui-charges-list svg")).toBeNull();
    expect(within(rows[0] as HTMLElement).getByRole("link")).toHaveAttribute("href", "/transactions/tx-10");
    expect(screen.getByText("עלה ב־38%")).toBeTruthy();
    expect(screen.getByText("לכל החיובים")).toBeTruthy();
  });

  it("shows with two charges, and nothing with one", () => {
    const { rerender, container } = render(
      <MemoryRouter>
        <PartyChargesHistory plain data={charges(2)} onShowAll={() => undefined} change={change} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll(".ui-charges-list li")).toHaveLength(2);
    expect(screen.queryByText("לכל החיובים")).toBeNull();
    rerender(
      <MemoryRouter>
        <PartyChargesHistory plain data={charges(1)} onShowAll={() => undefined} change={change} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ui-charges-history")).toBeNull();
  });

  it("draws no change line when the page has none, and the months it is given", () => {
    const { container } = render(
      <MemoryRouter>
        <PartyChargesHistory plain data={charges(3)} onShowAll={() => undefined} change={null} months={charges(3).months.slice(0, 2)} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ui-charges-line")).toBeNull();
    expect(container.querySelectorAll(".ui-charge-bar-col")).toHaveLength(2);
  });
});

describe("PartyChargesHistory on the transaction page (default, unchanged)", () => {
  it("lists the three earlier charges, not this line", () => {
    const { container } = render(
      <MemoryRouter>
        <PartyChargesHistory data={charges(5)} onShowAll={() => undefined} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll(".ui-charges-list li")).toHaveLength(3);
    expect(container.querySelector(".ui-charges-list .ui-charges-row-now")).toBeNull();
    expect(container.querySelector(".ui-charges-list a[href='/transactions/tx-10']")).toBeNull();
    expect(screen.getByText("לכל החיובים")).toBeTruthy();
  });
});

describe("ChargeMonthBars (FLOW-447c)", () => {
  it("draws a month with no charge as a 3px line, not a bar", () => {
    const { container } = render(<ChargeMonthBars months={charges(1).months} plain />);
    const bars = container.querySelectorAll(".ui-charge-bar");
    const empty = container.querySelectorAll(".ui-charge-bar-empty");
    expect(bars).toHaveLength(6);
    expect(empty).toHaveLength(1);
    expect(empty[0]?.getAttribute("style")).toBe("block-size: 3px;");
    expect(bars[5]?.getAttribute("style")).toBe("block-size: 56px;");
  });

  it("labels the page's bars with the month number", () => {
    const { container } = render(<ChargeMonthBars months={charges(1).months} plain />);
    const labels = [...container.querySelectorAll(".ui-charge-bar-label")].map((label) => label.textContent);
    expect(labels).toEqual(["05", "06", "07", "08", "09", "10"]);
  });
});
