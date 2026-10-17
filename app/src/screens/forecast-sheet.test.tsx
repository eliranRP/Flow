import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { monthForecastBoardSample } from "../forecast-sample";
import { renderWithProviders } from "../test-render";
import { ForecastItemSheet } from "./forecast-sheet";

const { build } = monthForecastBoardSample("board").data;
const noop = () => undefined;

describe("ForecastItemSheet source link (FLOW-141b)", () => {
  it("links a supplier bill to its unpaid list as לחשבון", () => {
    const bill = build.expense.find((item) => item.kind === "invoice");
    expect(bill).toBeTruthy();
    renderWithProviders(<ForecastItemSheet item={bill ?? null} today="2026-10-11" onOpenChange={noop} onSave={noop} />, { route: "/forecast" });
    expect(screen.getByRole("link", { name: "לחשבון" }).getAttribute("href")).toBe("/unpaid");
  });

  it("links a customer invoice to its unpaid list as לחשבונית", () => {
    const invoice = build.income.find((item) => item.kind === "invoice");
    renderWithProviders(<ForecastItemSheet item={invoice ?? null} today="2026-10-11" onOpenChange={noop} onSave={noop} />, { route: "/forecast" });
    expect(screen.getByRole("link", { name: "לחשבונית" }).getAttribute("href")).toBe("/unpaid");
  });

  it("links a recurring charge to קבועים as לחיוב הקבוע", () => {
    const charge = build.small[0];
    renderWithProviders(<ForecastItemSheet item={charge ?? null} today="2026-10-11" onOpenChange={noop} onSave={noop} />, { route: "/forecast" });
    expect(screen.getByRole("link", { name: "לחיוב הקבוע" }).getAttribute("href")).toBe("/recurring");
  });
});
