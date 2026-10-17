import type { MissingBill, PaymentRecurring, PartyCharges, RecurringChange } from "@flow/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import {
  RECURRING_CHARGES_FIXTURE_POWER,
  RECURRING_CHARGES_FIXTURE_WATER,
  RECURRING_MISSING_FIXTURE,
} from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { RecurringChargeScreen } from "./recurring-charge-screen";

// The page's reads and RPCs: the fixture's data, and a fake client whose RPCs succeed.
const state = vi.hoisted(() => ({
  data: null as unknown as { status: string },
  client: { rpc: null as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: null }> },
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

/** A ready page's data from a fixture, with its reads overridden where a test needs. */
type ChargeFixture = {
  row: ScheduleRow;
  bills?: MissingBill[];
  changes?: RecurringChange[];
  lineId: string | null;
  charges: PartyCharges | null;
  recurring: PaymentRecurring | null;
};

function ready(sample: ChargeFixture) {
  return { status: "ready", ...sample };
}

function renderPage(path: string, element = <RecurringChargeScreen now={NOW} />) {
  return renderWithProviders(
    <Routes>
      <Route path="/recurring/:direction/:partyId" element={element} />
      <Route path="/recurring" element={<p>רשימת הקבועים</p>} />
    </Routes>,
    { route: path },
  );
}

/** The RPC calls the page made, by name, with their arguments. */
function calls() {
  return vi.mocked(state.client.rpc).mock.calls;
}

beforeEach(() => {
  state.client = { rpc: vi.fn(() => Promise.resolve({ error: null })) };
  state.data = ready(RECURRING_CHARGES_FIXTURE_WATER);
});

describe("the charge page: the item (the water bill, arrived 38% over)", () => {
  it("shows the status, the amount and the banner the board shows", () => {
    renderPage("/recurring/expense/water");
    expect(screen.getByText("שולם 05/10")).toBeTruthy();
    expect(within(document.querySelector(".ui-charge-head") as HTMLElement).getByText("$142")).toBeTruthy();
    expect(screen.getByText("05/10/2026 · הוצאה")).toBeTruthy();
    expect(screen.getByText("גבוה ב־38% מהרגיל")).toBeTruthy();
    expect(screen.getByRole("button", { name: "התעלמות" })).toBeTruthy();
  });

  it("names its project and category as read-only rows, with no control", () => {
    renderPage("/recurring/expense/water");
    const card = screen.getByRole("region", { name: "פרויקט וקטגוריה" });
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).getByText("Elm Row")).toBeTruthy();
  });

  it("shows the history: the usual amount, the change and the three newest charges, this one included", () => {
    renderPage("/recurring/expense/water");
    expect(screen.getByText("חיובים קודמים")).toBeTruthy();
    expect(screen.getByText("עלה ב־38%")).toBeTruthy();
    expect(screen.getByText("לכל החיובים")).toBeTruthy();
    const history = screen.getByText("חיובים קודמים").closest("section") as HTMLElement;
    expect(within(history).getAllByRole("link")).toHaveLength(3);
  });

  it("ignores the banner's change: the grey line and החזרה replace it, and the toast's ביטול brings it back", async () => {
    renderPage("/recurring/expense/water");
    fireEvent.click(screen.getByRole("button", { name: "התעלמות" }));
    expect(await screen.findByText("התעלמת מההתראה. היא תחזור בשינוי הבא.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "החזרה" })).toBeTruthy();
    expect(screen.queryByText("גבוה ב־38% מהרגיל")).toBeNull();
    expect(calls()).toContainEqual(["dismiss_recurring_alert", { p_kind: "change", p_key: "tx-water-10" }]);
    expect(await screen.findByText("התעלמת מההתראה")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(screen.getByText("גבוה ב־38% מהרגיל")).toBeTruthy();
    });
    expect(calls()).toContainEqual(["undismiss_recurring_alert", { p_kind: "change", p_key: "tx-water-10" }]);
  });

  it("the recurring row opens the pace sheet with the five choices and the detected note", () => {
    renderPage("/recurring/expense/water");
    fireEvent.click(screen.getByRole("button", { name: /תשלום קבוע/ }));
    const sheet = screen.getByRole("dialog");
    for (const label of ["לא קבוע", "כל חודש", "כל חודשיים", "כל רבעון", "כל שנה"]) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
    expect(within(sheet).getByText("זוהה לבד מהתשלומים הקודמים")).toBeTruthy();
    expect(within(sheet).getByText("לא יופיע בקבועים, בהתראות ובתחזית")).toBeTruthy();
  });
});

describe("the charge page: the pace sheet picks", () => {
  it("picking כל רבעון saves the pace on the line and toasts it, with ביטול", async () => {
    renderPage("/recurring/expense/water", <RecurringChargeScreen now={NOW} openSheet="pace" />);
    fireEvent.click(screen.getByRole("radio", { name: "כל רבעון" }));
    expect(await screen.findByText("נשמר: כל רבעון")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_pace", { p_id: "tx-water-10", p_pace: "quarter" }]);
  });

  it("picking לא קבוע clears the switch and goes back to the list", async () => {
    renderPage("/recurring/expense/water", <RecurringChargeScreen now={NOW} openSheet="pace" />);
    fireEvent.click(screen.getByRole("radio", { name: "לא קבוע" }));
    expect(await screen.findByText("רשימת הקבועים")).toBeTruthy();
    expect(calls()).toContainEqual(["set_payment_recurring", { p_id: "tx-water-10", p_recurring: false }]);
    expect(await screen.findByText("סומן כלא קבוע")).toBeTruthy();
  });
});

describe("the charge page: the late bill (the power bill, with its suggested match)", () => {
  beforeEach(() => {
    state.data = ready(RECURRING_CHARGES_FIXTURE_POWER);
  });

  it("shows the lateness, and the match box with its name, amount and day", () => {
    renderPage("/recurring/expense/power");
    expect(screen.getByText("לא הגיע")).toBeTruthy();
    expect(screen.getByText("החשבון באיחור 8 ימים")).toBeTruthy();
    const box = screen.getByRole("region", { name: "אולי הגיע בשם אחר" });
    expect(within(box).getByText("Brightline Energy Svcs")).toBeTruthy();
    expect(within(box).getByText("$191")).toBeTruthy();
    expect(within(box).getByText("08/10")).toBeTruthy();
  });

  it("כן, אותו ספק answers the match as the same party, and ביטול takes it back", async () => {
    renderPage("/recurring/expense/power");
    fireEvent.click(screen.getByRole("button", { name: "כן, אותו ספק" }));
    expect(await screen.findByText("סומן כאותו ספק")).toBeTruthy();
    expect(calls()).toContainEqual(["answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: true }]);
    expect(screen.queryByRole("button", { name: "כן, אותו ספק" })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    expect(await screen.findByRole("button", { name: "כן, אותו ספק" })).toBeTruthy();
    expect(calls()).toContainEqual(["answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: null }]);
  });

  it("לא answers it as not the same, and toasts that it will not be offered again", async () => {
    renderPage("/recurring/expense/power");
    fireEvent.click(screen.getByRole("button", { name: "לא" }));
    expect(await screen.findByText("לא נציע שוב")).toBeTruthy();
    expect(calls()).toContainEqual(["answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: false }]);
  });

  it("an income party says כן, אותו לקוח", () => {
    const income = { ...RECURRING_CHARGES_FIXTURE_POWER.row, direction: "income" as const, party_id: "rent-elm" };
    const bills = [{ ...RECURRING_MISSING_FIXTURE[0], direction: "income" as const, party_id: "rent-elm", alert_key: "income:rent-elm:USD:2026-10" }] as typeof RECURRING_MISSING_FIXTURE;
    state.data = ready({ ...RECURRING_CHARGES_FIXTURE_POWER, row: income, bills });
    renderPage("/recurring/income/rent-elm");
    expect(screen.getByRole("button", { name: "כן, אותו לקוח" })).toBeTruthy();
  });

  it("an ignored late bill shows its grey line, and no match box", () => {
    state.data = ready({ ...RECURRING_CHARGES_FIXTURE_POWER, bills: RECURRING_MISSING_FIXTURE.filter((bill) => bill.party_id !== "power") });
    renderPage("/recurring/expense/power");
    expect(screen.getByText("התעלמת מההתראה. היא תחזור אם גם החיוב הבא יאחר.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "אולי הגיע בשם אחר" })).toBeNull();
    expect(screen.getByRole("button", { name: "החזרה" })).toBeTruthy();
  });

  it("with the late bill's read failed, the alert still shows, and cannot be ignored without its key", () => {
    state.data = ready({ ...RECURRING_CHARGES_FIXTURE_POWER, bills: undefined, changes: undefined });
    renderPage("/recurring/expense/power");
    expect(screen.getByText("החשבון באיחור 8 ימים")).toBeTruthy();
    expect(screen.getByRole("button", { name: "התעלמות" })).toBeDisabled();
  });
});

describe("the charge page: the states", () => {
  it("a party with no recurring row is the not-found view", () => {
    state.data = { status: "missing" };
    renderPage("/recurring/expense/nobody");
    expect(screen.getByText("החיוב לא נמצא")).toBeTruthy();
  });

  it("a direction that is neither expense nor income is the not-found view", () => {
    renderPage("/recurring/sideways/water");
    expect(screen.getByText("החיוב לא נמצא")).toBeTruthy();
  });

  it("a failed schedule read shows the error with a retry", () => {
    state.data = { status: "error" };
    renderPage("/recurring/expense/water");
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeTruthy();
  });

  it("while the schedule loads, the page shows its skeleton", () => {
    state.data = { status: "loading" };
    const { container } = renderPage("/recurring/expense/water");
    expect(container.querySelector("[aria-busy='true']") ?? container.querySelector(".ui-charge-page")).toBeTruthy();
  });
});
