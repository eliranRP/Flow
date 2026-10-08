import type { Dashboard } from "@flow/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeBooks } from "./HomeScreen";
import { heroExplanation, periodPhrase, stepPeriod, thisMonth } from "../period";

function books(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    company_id: "co",
    name: "Flow Test",
    vat_registered: true,
    basis: "invoiced",
    from: "2026-09-01",
    to: "2026-09-28",
    income_agorot: 47_200_000n,
    direct_agorot: 43_283_600n,
    shared_agorot: 0n,
    overhead_agorot: 0n,
    expense_agorot: 43_283_600n,
    net_profit_agorot: 3_916_400n,
    prev_income_agorot: 40_000_000n,
    prev_expense_agorot: 38_000_000n,
    prev_net_agorot: 2_000_000n,
    active_projects: 0,
    review_count: 0,
    projects: [],
    by_currency: [],
    ...overrides,
  };
}

function renderHome(data: Dashboard, period = thisMonth()) {
  return render(
    <MemoryRouter>
      <HomeBooks
        data={data}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={period}
        onPeriod={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("Home hero", () => {
  it("shows one label, the figure, and the explanation, and keeps income outside the band", () => {
    renderHome(books());
    expect(screen.queryByText("Flow")).not.toBeInTheDocument();
    expect(screen.queryByText(/שלום/)).not.toBeInTheDocument();
    const label = screen.getByText("רווח נקי החודש");
    expect(label).toHaveClass("ui-band-label");
    const style = getComputedStyle(label);
    expect(style.paddingInlineStart === "0px" || style.paddingInlineStart === "0").toBe(true);
    expect(style.paddingInlineEnd === "0px" || style.paddingInlineEnd === "0").toBe(true);
    expect(style.textAlign === "start" || style.textAlign === "right").toBe(true);
    expect(screen.getByRole("heading", { name: "₪39,164" })).toBeInTheDocument();
    expect(screen.getByText(heroExplanation())).toBeInTheDocument();
    const income = screen.getByText("נכנס");
    const spent = screen.getByText("יצא");
    expect(income.closest(".ui-band")).toBeNull();
    expect(spent.closest(".ui-band")).toBeNull();
    expect(document.querySelector(".ui-band .ui-band-figures")).toBeNull();
    expect(screen.getByText("מחודש שעבר").closest(".ui-band")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "תקופה" }).closest(".ui-band")).not.toBeNull();
  });

  it("shows USD-only books without shekel placeholders or change pill", () => {
    renderHome(books({
      income_agorot: 0n,
      expense_agorot: 0n,
      net_profit_agorot: 0n,
      projects: [],
      by_currency: [{
        currency: "USD",
        income_minor: 500_000n,
        direct_minor: 200_000n,
        shared_minor: 0n,
        overhead_minor: 0n,
        expense_minor: 200_000n,
        net_profit_minor: 300_000n,
        count: 4,
      }],
    }));
    expect(screen.getByRole("heading", { name: "$3,000" })).toBeInTheDocument();
    expect(screen.getByText("$2,000")).toBeInTheDocument();
    expect(screen.getByText("$5,000")).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    expect(screen.queryByText("מחודש שעבר")).not.toBeInTheDocument();
  });

  it("shows a USD company's change from its own previous period (0147)", () => {
    renderHome(books({
      base_currency: "USD",
      income_agorot: 0n,
      expense_agorot: 0n,
      net_profit_agorot: 0n,
      prev_income_agorot: 0n,
      prev_expense_agorot: 0n,
      prev_net_agorot: 0n,
      by_currency: [{
        currency: "USD",
        income_minor: 500_000n,
        direct_minor: 200_000n,
        shared_minor: 0n,
        overhead_minor: 0n,
        expense_minor: 200_000n,
        net_profit_minor: 300_000n,
        count: 4,
        prev_income_minor: 400_000n,
        prev_expense_minor: 200_000n,
        prev_net_profit_minor: 200_000n,
      }],
    }));
    expect(screen.getByRole("heading", { name: "$3,000" })).toBeInTheDocument();
    expect(screen.getByText("מחודש שעבר")).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("shows one figure per currency without converting", () => {
    renderHome(books({
      income_agorot: 100_000n,
      expense_agorot: 40_000n,
      by_currency: [
        { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 40_000n, net_profit_minor: 60_000n, count: 1 },
        { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 50_000n, net_profit_minor: 150_000n, count: 1 },
      ],
    }));
    expect(screen.getByText("₪600")).toBeInTheDocument();
    expect(screen.getByText("$1,500")).toBeInTheDocument();
    expect(screen.getByText("רווח נקי החודש")).toBeInTheDocument();
    expect(screen.queryByText("מחודש שעבר")).not.toBeInTheDocument();
  });

  it("compares a quiet month of a USD company with its previous one (0147)", () => {
    renderHome(books({
      base_currency: "USD",
      income_agorot: 0n,
      expense_agorot: 0n,
      direct_agorot: 0n,
      net_profit_agorot: 0n,
      prev_income_agorot: 0n,
      prev_expense_agorot: 0n,
      prev_net_agorot: 0n,
      by_currency: [{
        currency: "USD",
        income_minor: 0n,
        direct_minor: 0n,
        shared_minor: 0n,
        overhead_minor: 0n,
        expense_minor: 0n,
        net_profit_minor: 0n,
        count: 0,
        prev_income_minor: 400_000n,
        prev_expense_minor: 200_000n,
        prev_net_profit_minor: 200_000n,
      }],
    }));
    expect(screen.getByRole("heading", { name: "$0" })).toBeInTheDocument();
    expect(screen.getByText("מחודש שעבר")).toBeInTheDocument();
  });

  it("names a loss in the label", () => {
    const period = stepPeriod(thisMonth(), -1) ?? thisMonth();
    renderHome(books({ income_agorot: 10_000_000n, expense_agorot: 20_000_000n, net_profit_agorot: -10_000_000n }), period);
    expect(screen.getByText(`הפסד ${periodPhrase(period)}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "−₪100,000" })).toBeInTheDocument();
    expect(screen.getByText(heroExplanation())).toBeInTheDocument();
  });
});

describe("Home flow rows (FLOW-301)", () => {
  it("opens the breakdown from נכנס and יצא, naming the period and amount", () => {
    renderHome(books());
    const out = screen.getByRole("link", { name: "יצא החודש ₪432,836 – פירוט" });
    expect(out).toHaveAttribute("href", "/flow/expense");
    expect(screen.getByRole("link", { name: /^נכנס החודש/ })).toHaveAttribute("href", "/flow/income");
  });

  it("reads a cost under יצא with no minus, since the label says the money went out (FLOW-334 H3)", () => {
    renderHome(books());
    const out = screen.getByRole("link", { name: "יצא החודש ₪432,836 – פירוט" });
    expect(out).toHaveTextContent("₪432,836");
    expect(out).not.toHaveTextContent("−");
  });

  it("keeps the minus under יצא only when refunds beat costs (FLOW-334 H3)", () => {
    renderHome(books({ expense_agorot: -1_250_000n, direct_agorot: -1_250_000n, net_profit_agorot: 48_450_000n }));
    const out = screen.getByRole("link", { name: "יצא החודש −₪12,500 – פירוט" });
    expect(out).toHaveTextContent("−₪12,500");
  });
});
