// FLOW-965 (Lines v2): the month's lines page in its failed, offline, empty and waiting states.
// Invented figures only.
import { onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cashMonthName } from "../cash";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelHourMinute } from "../ui/band-states";
import { israelToday } from "../ui/date-math";
import { CashLinesScreen } from "./cash-lines-screen";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

const current = israelToday().slice(0, 7);
const earlier = shiftMonthKey(current, -1);

function currencyRow(inMinor: number, outMinor: number) {
  return { currency: "ILS", in_minor: inMinor, out_minor: outMinor, net_minor: inMinor - outMinor, profit_minor: 0, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0 };
}

const months = {
  basis: "paid",
  base_currency: "ILS",
  months: [
    { month: `${current}-01`, by_currency: [currencyRow(0, 50_000)] },
    { month: `${earlier}-01`, by_currency: [currencyRow(100_000, 215_000)] },
  ],
};

function line(id: string, pending: boolean) {
  return {
    transaction_id: id,
    part: null,
    description: "קניה",
    supplier_name: `ספק ${id}`,
    project_name: "בית לדוגמה",
    category_name: "חומרים",
    doc_date: `${earlier}-02`,
    cash_month_date: `${earlier}-03`,
    currency: "ILS",
    amount_minor: 10_000,
    side: "out",
    shared: false,
    source: "mercury",
    kept_out: false,
    pending,
  };
}

function serve(lines: { rows: unknown[]; has_more: boolean } | "fail") {
  rpc.impl = (name) => {
    if (name === "cash_months") return Promise.resolve({ data: months, error: null });
    if (name === "cash_month_lines") {
      return Promise.resolve(lines === "fail" ? { data: null, error: { message: "boom" } } : { data: lines, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
}

function wrap(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/cash/:month/:side/:currency" element={<CashLinesScreen />} />
      <Route path="/help" element={<p>עזרה</p>} />
    </Routes>,
    { route: path },
  );
}

beforeEach(() => {
  rpc.calls = [];
  serve({ rows: [line("a", false)], has_more: false });
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("Lines v2 states (FLOW-965)", () => {
  it("a failed read says what did not load, retries, and offers help", async () => {
    serve("fail");
    wrap(`/cash/${earlier}/out/ILS`);
    const name = cashMonthName(earlier);
    expect(await screen.findByRole("heading", { name: `יצא של ${name} לא נטען` })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
    const before = rpc.calls.filter((call) => call.name === "cash_month_lines").length;
    serve({ rows: [line("a", false)], has_more: false });
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByText("ספק a")).toBeInTheDocument();
    expect(rpc.calls.filter((call) => call.name === "cash_month_lines").length).toBeGreaterThan(before);
  });

  it("offline, the lines stay and a line says from when", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("ספק a")).toBeInTheDocument();
    act(() => { onlineManager.setOnline(false); });
    const status = await screen.findByText(/אין חיבור · מוצג המצב מ־/);
    expect(status.textContent).toMatch(/\d{2}:\d{2}/);
    expect(israelHourMinute(Date.now())).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByText("ספק a")).toBeInTheDocument();
  });

  it("an empty month says so and opens the other side", async () => {
    serve({ rows: [], has_more: false });
    wrap(`/cash/${current}/in/ILS`);
    const name = cashMonthName(current);
    expect(await screen.findByRole("heading", { name: `עוד לא נכנס כסף ב${name}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `מה יצא ב${name}` }));
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "cash_month_lines" && (call.args as { p_side: string }).p_side === "out")).toBe(true);
    });
  });

  it("a past month with no lines drops the עוד", async () => {
    serve({ rows: [], has_more: false });
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByRole("heading", { name: `לא יצא כסף ב${cashMonthName(earlier)}` })).toBeInTheDocument();
  });

  it("lines waiting for approval are the filled review button, not a count part", async () => {
    serve({ rows: [line("a", true), line("b", true), line("c", false)], has_more: false });
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("ספק c")).toBeInTheDocument();
    const button = screen.getByRole("link", { name: /לאישור 2 פריטים/ });
    expect(button).toHaveAttribute("href", "/review");
    expect(button.textContent).toContain("· כדקה");
    expect(screen.queryByText(/ממתינות לאישור/)).toBeNull();
  });
});
