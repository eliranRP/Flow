import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { RECURRING_CHARGES_FIXTURE_WATER } from "../recurring-sample";
import { RecurringChargeScreen } from "./recurring-charge-screen";

// FLOW-1266: the charge page's end date, its row, its sheets and its write.
const state = vi.hoisted(() => ({
  data: null as unknown as { status: string },
  client: { rpc: null as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: null | { message: string }; data?: unknown }> },
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

function rowWith(endsOn: string | null) {
  return { ...RECURRING_CHARGES_FIXTURE_WATER.row, pace: "month" as const, next_due_month: "2026-11", ends_on: endsOn };
}

beforeEach(() => {
  state.client = { rpc: vi.fn(() => Promise.resolve({ error: null })) };
  state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER, row: rowWith(null) };
});

describe("the charge page: the end date", () => {
  it("shows ללא on its row when there is no end date", () => {
    renderPage();
    const row = screen.getByRole("button", { name: /תאריך סיום/ });
    expect(within(row).getByText("ללא")).toBeTruthy();
  });

  it("offers the presets with their dates; a tap writes the date for the charge and toasts with ביטול", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /תאריך סיום/ }));
    const sheet = screen.getByRole("dialog");
    for (const date of ["30/11/2026", "11/01/2027", "11/04/2027", "31/12/2026"]) expect(within(sheet).getByText(date)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("radio", { name: /בסוף השנה/ }));
    expect(await screen.findByText("מסתיים ב־31/12/2026: Bayside Water Utility")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_end", { p_id: "tx-water-10", p_ends_on: "2026-12-31", p_project_id: "p-elm-row" }]);
    await waitFor(() => {
      expect(within(screen.getByRole("button", { name: /תאריך סיום/ })).getByText("31/12/2026")).toBeTruthy();
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["set_payment_end", { p_id: "tx-water-10", p_ends_on: null, p_project_id: "p-elm-row" }]);
    });
  });

  it("an end date the owner picked shows as its own row, and ללא תאריך סיום removes it", async () => {
    state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER, row: rowWith("2027-05-05") };
    state.client = { rpc: vi.fn(() => Promise.resolve({ error: null, data: { prior_ends_on: "2027-05-05" } })) };
    renderPage(<RecurringChargeScreen now={NOW} openSheet="end" />);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("radio", { name: /התאריך שבחרת/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(sheet).getByRole("radio", { name: /ללא תאריך סיום/ }));
    expect(await screen.findByText("תאריך הסיום הוסר: Bayside Water Utility")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_end", { p_id: "tx-water-10", p_ends_on: null, p_project_id: "p-elm-row" }]);
  });

  it("תאריך אחר opens the date sheet", async () => {
    renderPage(<RecurringChargeScreen now={NOW} openSheet="end" />);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "תאריך אחר" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "שמירה" })).toBeTruthy();
    });
  });

  it("a viewer reads the date but cannot open the sheet", () => {
    renderPage(<ViewerPreview><RecurringChargeScreen now={NOW} /></ViewerPreview>);
    const row = screen.getByRole("button", { name: /תאריך סיום/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });
});
