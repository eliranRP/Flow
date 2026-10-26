import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { RECURRING_CHARGES_FIXTURE_WATER } from "../recurring-sample";
import { chargePickToast } from "./recurring-charge-pick";
import { RecurringChargeScreen } from "./recurring-charge-screen";

// The page's reads and RPCs: the water bill, the company's projects and categories, and a fake client.
const state = vi.hoisted(() => ({
  data: null as unknown as { status: string; split?: boolean },
  client: { rpc: null as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error: unknown }> },
}));

vi.mock("../recurring-charge-data", async (original) => ({
  ...(await original<typeof import("../recurring-charge-data")>()),
  useChargePageData: () => state.data,
}));

vi.mock("../recurring-actions", async (original) => ({
  ...(await original<typeof import("../recurring-actions")>()),
  liveRpcClient: () => state.client,
}));

vi.mock("../use-books", async (original) => ({
  ...(await original<typeof import("../use-books")>()),
  useDashboardQuery: () => ({
    data: {
      projects: [
        { id: "p-elm-row", name: "Elm Row", status: "active" },
        { id: "p-cedar", name: "Cedar St", status: "active" },
        { id: "p-old", name: "Old Mill", status: "finished" },
      ],
    },
  }),
  useCategoriesQuery: () => ({
    data: [
      { id: "c-water", name: "חשמל ומים", kind: "expense", hidden: false },
      { id: "c-repair", name: "אחזקה", kind: "expense", hidden: false },
      { id: "c-rent", name: "שכירות", kind: "income", hidden: false },
      { id: "c-gone", name: "ישן", kind: "expense", hidden: true },
    ],
  }),
}));

const NOW = new Date("2026-10-11T12:00:00Z");

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/recurring/:direction/:partyId" element={<RecurringChargeScreen now={NOW} />} />
    </Routes>,
    { route: "/recurring/expense/water" },
  );
}

function calls() {
  return vi.mocked(state.client.rpc).mock.calls;
}

beforeEach(() => {
  state.client = {
    rpc: vi.fn((name: string) => Promise.resolve(
      name === "reassign_recurring_charge" ? { data: { changed: 3, skipped: 1, undo_ids: ["u1", "u2", "u3"] }, error: null } : { data: null, error: null },
    )),
  };
  state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER };
});

describe("the charge page's pickers (FLOW-963)", () => {
  it("opens the project picker with the active projects and the rule under the title", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("חל על כל התשלומים של Bayside Water Utility, גם הקודמים")).toBeTruthy();
    expect(within(sheet).getAllByRole("radio").map((radio) => radio.textContent.replace("✓", ""))).toEqual(["Elm Row", "Cedar St"]);
    expect(within(sheet).getByRole("radio", { name: "Elm Row" })).toBeChecked();
  });

  it("lists the charge's kind of categories, and no hidden one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה חשמל ומים" }));
    expect(within(screen.getByRole("dialog")).getAllByRole("radio").map((radio) => radio.textContent.replace("✓", ""))).toEqual(["חשמל ומים", "אחזקה"]);
  });

  it("a project pick moves every payment, toasts under the header, and ביטול puts them back", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Cedar St" }));
    expect(await screen.findByText("Bayside Water Utility עבר לCedar St · תשלום אחד לא שונה")).toBeTruthy();
    expect(calls()).toContainEqual(["reassign_recurring_charge", {
      p_direction: "expense", p_party_id: "water", p_currency: "USD", p_charge_project_id: null, p_project_id: "p-cedar", p_category_id: null,
    }]);
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["undo_reassign_recurring_charge", { p_undo_ids: ["u1", "u2", "u3"] }]);
    });
  });

  it("a category pick names the category and keeps the project", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה חשמל ומים" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "אחזקה" }));
    await waitFor(() => {
      expect(calls()).toContainEqual(["reassign_recurring_charge", {
        p_direction: "expense", p_party_id: "water", p_currency: "USD", p_charge_project_id: null, p_project_id: null, p_category_id: "c-repair",
      }]);
    });
  });

  it("a party split by project names this charge's project", async () => {
    state.data = { status: "ready", ...RECURRING_CHARGES_FIXTURE_WATER, split: true };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Cedar St" }));
    await waitFor(() => {
      expect(calls()).toContainEqual(["reassign_recurring_charge", expect.objectContaining({ p_charge_project_id: "p-elm-row", p_project_id: "p-cedar" })]);
    });
  });

  it("a refused pick says so and changes nothing on the page", async () => {
    state.client = { rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: "project not found" } })) };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Cedar St" }));
    expect(await screen.findByText("לא הצלחנו לעדכן את התשלומים.")).toBeTruthy();
    // The sheet stays open over the page, which still names the project it had.
    expect(screen.getByRole("button", { name: "פרויקט Elm Row", hidden: true })).toBeTruthy();
  });
});

describe("chargePickToast", () => {
  it("names the party and the target, and what it left", () => {
    expect(chargePickToast("Water", "Cedar St", { changed: 3, skipped: 0 })).toBe("Water עבר לCedar St");
    expect(chargePickToast("Water", "Cedar St", { changed: 3, skipped: 2 })).toBe("Water עבר לCedar St · 2 תשלומים לא שונו");
    expect(chargePickToast("Water", "Cedar St", { changed: 0, skipped: 2 })).toBe("לא היה מה לשנות");
  });
});
