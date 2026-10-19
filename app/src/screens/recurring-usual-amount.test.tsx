import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { RECURRING_CHARGES_FIXTURE_WATER } from "../recurring-sample";
import { RecurringChargeScreen } from "./recurring-charge-screen";

// Decision 0189: the charge page's usual amount, its row, its sheet and its write.
const state = vi.hoisted(() => ({
  data: null as unknown as { status: string },
  client: { rpc: null as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: null | { message: string } }> },
}));

vi.mock("../recurring-charge-data", async (original) => ({
  ...(await original<typeof import("../recurring-charge-data")>()),
  useChargePageData: () => state.data,
}));

vi.mock("../recurring-actions", async (original) => ({
  ...(await original<typeof import("../recurring-actions")>()),
  liveRpcClient: () => state.client,
}));

const NOW = new Date("2026-10-11T12:00:00Z");

function renderPage(element = <RecurringChargeScreen now={NOW} />) {
  return renderWithProviders(
    <Routes>
      <Route path="/recurring/:direction/:partyId" element={element} />
    </Routes>,
    { route: "/recurring/expense/water" },
  );
}

function calls() {
  return vi.mocked(state.client.rpc).mock.calls;
}

function ownerRow() {
  return { ...RECURRING_CHARGES_FIXTURE_WATER.row, typical_amount_minor: -12000, typical_amount_source: "owner" as const };
}

beforeEach(() => {
  state.client = { rpc: vi.fn(() => Promise.resolve({ error: null })) };
  state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER };
});

describe("the charge page: the usual amount", () => {
  it("shows Flow's own usual amount on its row, with no קבעת", () => {
    renderPage();
    const row = screen.getByRole("button", { name: /הסכום הרגיל/ });
    expect(within(row).getByText("$103")).toBeTruthy();
    expect(within(row).getByText("לפי החודשים האחרונים")).toBeTruthy();
    expect(within(row).queryByText("קבעת")).toBeNull();
  });

  it("tapping it opens the sheet with the amount; שמירה writes it for the charge and toasts with ביטול", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /הסכום הרגיל/ }));
    const sheet = screen.getByRole("dialog");
    const field = within(sheet).getByRole("textbox", { name: "הסכום הרגיל" });
    expect((field as HTMLInputElement).value).toBe("103");
    expect(within(sheet).queryByRole("button", { name: "חזרה לחישוב" })).toBeNull();
    fireEvent.change(field, { target: { value: "120" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("הסכום הרגיל עודכן: Bayside Water Utility")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_amount", { p_id: "tx-water-10", p_amount_minor: 12000, p_project_id: "p-elm-row" }]);
    const row = screen.getByRole("button", { name: /הסכום הרגיל/ });
    expect(within(row).getByText("קבעת")).toBeTruthy();
    expect(within(row).getByText("$120")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["set_payment_amount", { p_id: "tx-water-10", p_amount_minor: null, p_project_id: "p-elm-row" }]);
    });
  });

  it("an empty amount asks for one and writes nothing", () => {
    renderPage(<RecurringChargeScreen now={NOW} openSheet="amount" />);
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByRole("textbox", { name: "הסכום הרגיל" }), { target: { value: "" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "שמירה" }));
    expect(within(sheet).getByRole("alert").textContent).toBe("כתבו סכום");
    expect(calls()).toHaveLength(0);
  });

  it("an amount the owner set shows קבעת, and חזרה לחישוב clears it; ביטול writes it back", async () => {
    state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER, row: ownerRow() };
    renderPage();
    const row = screen.getByRole("button", { name: /הסכום הרגיל/ });
    expect(within(row).getByText("קבעת")).toBeTruthy();
    fireEvent.click(row);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "חזרה לחישוב" }));
    expect(await screen.findByText("הסכום הרגיל חזר לחישוב: Bayside Water Utility")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_amount", { p_id: "tx-water-10", p_amount_minor: null, p_project_id: "p-elm-row" }]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["set_payment_amount", { p_id: "tx-water-10", p_amount_minor: 12000, p_project_id: "p-elm-row" }]);
    });
  });

  it("a failed write keeps the sheet's amount and says so", async () => {
    state.client = { rpc: vi.fn(() => Promise.resolve({ error: { message: "boom" } })) };
    renderPage(<RecurringChargeScreen now={NOW} openSheet="amount" />);
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByRole("textbox", { name: "הסכום הרגיל" }), { target: { value: "99" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו לעדכן את השורה.")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByDisplayValue("99")).toBeTruthy();
  });

  it("a viewer reads the amount but cannot open the sheet", () => {
    renderPage(<ViewerPreview><RecurringChargeScreen now={NOW} /></ViewerPreview>);
    const row = screen.getByRole("button", { name: /הסכום הרגיל/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });
});
