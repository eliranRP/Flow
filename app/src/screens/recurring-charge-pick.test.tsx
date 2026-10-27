import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { RECURRING_CHARGES_FIXTURE_WATER } from "../recurring-sample";
import { chargePickToast, chargeUndoFailure } from "./recurring-charge-pick";
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

/** The address the page is on, shown under it so a test can read where a pick moved it. */
function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/recurring/:direction/:partyId" element={<><RecurringChargeScreen now={NOW} /><Where /></>} />
    </Routes>,
    { route: "/recurring/expense/water" },
  );
}

/** The fake client's answer to a pick, and to its undo. */
function answers(pick: Record<string, unknown>, undo: { data: null; error: unknown } = { data: null, error: null }) {
  return vi.fn((name: string) => Promise.resolve(
    name === "reassign_recurring_charge" ? { data: pick, error: null } : name === "undo_reassign_recurring_charge" ? undo : { data: null, error: null },
  ));
}

function calls() {
  return vi.mocked(state.client.rpc).mock.calls;
}

beforeEach(() => {
  state.client = { rpc: answers({ changed: 3, skipped: 1, split: false, undo_ids: ["u1", "u2", "u3"] }) };
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
      p_direction: "expense", p_party_id: "water", p_currency: "USD", p_charge_project_id: "p-elm-row", p_project_id: "p-cedar", p_category_id: null,
    }]);
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    // One charge: the address stays.
    expect(screen.getByTestId("where").textContent).toBe("/recurring/expense/water");
    // The sheet closes on its own frame; until then the toast sits behind it (aria-hidden).
    const undo = await screen.findByRole("button", { name: "ביטול" });
    act(() => {
      // A second tap while the undo runs sends nothing.
      fireEvent.click(undo);
      fireEvent.click(undo);
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["undo_reassign_recurring_charge", { p_undo_ids: ["u1", "u2", "u3"] }]);
    });
    expect(calls().filter(([name]) => name === "undo_reassign_recurring_charge")).toHaveLength(1);
  });

  it("a category pick names the category and keeps the project", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה חשמל ומים" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "אחזקה" }));
    await waitFor(() => {
      expect(calls()).toContainEqual(["reassign_recurring_charge", {
        p_direction: "expense", p_party_id: "water", p_currency: "USD", p_charge_project_id: "p-elm-row", p_project_id: null, p_category_id: "c-repair",
      }]);
    });
  });

  it("a project pick on a split charge moves the page to the charge's new address, and ביטול still works there", async () => {
    state.client = { rpc: answers({ changed: 2, skipped: 0, split: true, undo_ids: ["u1", "u2"] }) };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Cedar St" }));
    expect(await screen.findByText("Bayside Water Utility עבר לCedar St")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("where").textContent).toBe("/recurring/expense/water?project=p-cedar");
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(calls()).toContainEqual(["undo_reassign_recurring_charge", { p_undo_ids: ["u1", "u2"] }]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("where").textContent).toBe("/recurring/expense/water?project=p-elm-row");
    });
  });

  it("an undo refused because a payment changed since says so", async () => {
    state.client = { rpc: answers({ changed: 3, skipped: 0, split: false, undo_ids: ["u1"] }, { data: null, error: { message: "conflict" } }) };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט Elm Row" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Cedar St" }));
    const undo = await screen.findByRole("button", { name: "ביטול" });
    act(() => {
      fireEvent.click(undo);
    });
    expect(await screen.findByText("תשלום השתנה מאז, אז הביטול לא בוצע.")).toBeTruthy();
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

  it("tells a conflict from another failure", () => {
    expect(chargeUndoFailure({ message: "conflict" })).toBe("תשלום השתנה מאז, אז הביטול לא בוצע.");
    expect(chargeUndoFailure(new Error("network"))).toBe("לא הצלחנו לבטל.");
  });
});
