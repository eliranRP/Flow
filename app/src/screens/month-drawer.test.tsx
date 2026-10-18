import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { MonthDrawer } from "./month-drawer";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => rpc.impl(name, args),
  }),
}));

const year = Number(israelToday().slice(0, 4));
const currentKey = israelToday().slice(0, 7);

// Invented figures only: two months with data this year, one before the books' first month.
function yearMonths(y: number) {
  return {
    basis: "paid",
    base_currency: "ILS",
    months: [
      { month: `${String(y)}-03-01`, by_currency: [{ currency: "ILS", in_minor: 500_000, out_minor: 300_000, net_minor: 200_000, profit_minor: 0, excluded_count: 0, excluded_in_minor: 0, excluded_out_minor: 0, not_in_profit_categories: [] }] },
    ],
  };
}

function renderDrawer(props: Partial<Parameters<typeof MonthDrawer>[0]> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  rpc.impl = (name) => Promise.resolve({ data: name === "cash_year_months" ? yearMonths(year) : null, error: null });
  renderWithProviders(
    <MonthDrawer
      open
      onOpenChange={onOpenChange}
      selectedKey={currentKey}
      firstKey={`${String(year)}-03`}
      base="ILS"
      onPick={onPick}
      {...props}
    />,
  );
  return { onPick, onOpenChange };
}

beforeEach(() => {
  rpc.impl = () => Promise.resolve({ data: null, error: null });
});

describe("MonthDrawer (FLOW-364)", () => {
  it("opens on the year with twelve months, the selected one marked", async () => {
    renderDrawer();
    expect(await screen.findByRole("dialog", { name: "בחירת חודש" })).toBeInTheDocument();
    const cells = screen.getAllByRole("button").filter((node) => node.classList.contains("ui-month-cell"));
    expect(cells).toHaveLength(12);
    const selected = cells.find((cell) => cell.getAttribute("aria-current") === "date");
    expect(selected).toBeDefined();
  });

  it("disables the months after today, and shows them as not yet", async () => {
    renderDrawer();
    await screen.findByRole("dialog", { name: "בחירת חודש" });
    const cells = Array.from(document.querySelectorAll<HTMLButtonElement>(".ui-month-cell"));
    const future = cells.filter((cell) => cell.classList.contains("ui-month-cell-future"));
    expect(future.length).toBe(12 - Number(currentKey.slice(5, 7)));
    for (const cell of future) {
      expect(cell).toBeDisabled();
      expect(within(cell).getByText("עוד לא")).toBeInTheDocument();
    }
  });

  it("disables the later year on the current year, and a month picked closes nothing itself", async () => {
    const { onPick } = renderDrawer();
    await screen.findByRole("dialog", { name: "בחירת חודש" });
    expect(screen.getByRole("button", { name: "שנה הבאה" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: /מרץ, נטו/ }));
    expect(onPick).toHaveBeenCalledWith(`${String(year)}-03`);
  });

  it("disables the earlier year at the books' first year", async () => {
    renderDrawer();
    await screen.findByRole("dialog", { name: "בחירת חודש" });
    expect(screen.getByRole("button", { name: "שנה קודמת" })).toHaveAttribute("aria-disabled", "true");
  });
});
