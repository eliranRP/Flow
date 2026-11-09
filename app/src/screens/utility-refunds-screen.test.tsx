import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityRefundsRow } from "./attention-rows";
import { UtilityRefundsScreen } from "./utility-refunds-screen";
import { GEFEN, PINE, utilityRefundsSample } from "./utility-refunds-sample";
import { ToastProvider } from "../ui/toast";
import { parseUtilityRefundCount } from "../utility-refund-count";
import { cardWhy, paymentMeta, refundGroups } from "../utility-refund-view";
import type { UtilityBill } from "../utility-refunds";

// FLOW-1135 (decision 0265): החזרי חשבונות. Home's row, the cards, and every live answer with its ביטול.
const db = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: unknown }>,
  fail: false,
  hold: false,
  bills: [] as unknown[],
}));

vi.mock("../utility-refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utility-refunds")>();
  return {
    ...actual,
    useUtilityRefundsQuery: () => useQuery({ queryKey: ["utility-refunds", "off", ""], queryFn: () => Promise.resolve({ as_of: "2026-11-09", bills: db.bills as UtilityBill[] }) }),
  };
});

vi.mock("../search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../search")>();
  const row = {
    id: "pay-picked", description: "Zelle", doc_date: "2026-10-01", doc_kind: null, amount_net: 12_840n, vat_agorot: null, direction: "income" as const,
    currency: "USD", amount_original: 12_840n, project_id: "p-gefen-3", category_id: "c-rent", project_name: "דירת הגפן 3", category_name: "שכירות",
    supplier_name: null, customer_name: "Tenant A", waiting_review: false, kept_out: false, split_parts: 0, loan_matched: false,
  };
  return {
    ...actual,
    useSearchQuery: (filters: { project: string | null }) => useQuery({
      queryKey: ["search", "off", filters.project],
      queryFn: () => Promise.resolve({ pages: filters.project === "none" ? [] : [{ total: 1, expenses: [row], months: null, next: null }], pageParams: [] }),
    }),
  };
});

vi.mock("../use-is-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => db.hold,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      if (db.fail) return Promise.resolve({ data: null, error: { message: "refused" } });
      const data = name === "mark_utility_refunds_seen"
        ? { bill_transaction_ids: ["b-power-gefen", "b-gas-gefen"] }
        : name === "set_utility_payer" ? { prior: null } : null;
      return Promise.resolve({ data, error: null });
    },
  }),
}));

afterEach(() => {
  db.rpcs = [];
  db.fail = false;
  db.hold = false;
  db.bills = [];
  window.localStorage.clear();
});

function renderScreen(entry = "/utility-refunds") {
  db.bills = db.bills.length > 0 ? db.bills : utilityRefundsSample();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <UtilityRefundsScreen />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const calls = (name: string) => db.rpcs.filter((call) => call.name === name).map((call) => call.args);

async function undo() {
  fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
}

describe("Home's utility refunds row", () => {
  it("counts the bills not refunded with their total, singular for one, and opens החזרי חשבונות", () => {
    const row = utilityRefundsRow({ notRefunded: 4, suggested: 2, totals: [{ currency: "USD", minor: 29_539n }] }, "/utility-refunds?preview=1");
    expect(row?.to).toBe("/utility-refunds?preview=1");
    expect(row?.tag).toBe("$295.39");
    expect(row?.dismissKey).toBe("utility-refunds:4:2:USD29539");
    render(<p>{row?.title}</p>);
    expect(screen.getByText(/חשבונות לא הוחזרו/).textContent).toBe("4 חשבונות לא הוחזרו · $295.39");
    const one = utilityRefundsRow({ notRefunded: 1, suggested: 0, totals: [{ currency: "USD", minor: 4_600n }] }, "/utility-refunds");
    render(<p>{one?.title}</p>);
    expect(screen.getByText(/חשבון אחד לא הוחזר/).textContent).toBe("חשבון אחד לא הוחזר · $46");
  });

  it("shows only when there is one; suggestions alone read לבדיקה; two currencies show the count", () => {
    expect(utilityRefundsRow({ notRefunded: 0, suggested: 0, totals: [] }, "/u")).toBeNull();
    expect(utilityRefundsRow({ notRefunded: 0, suggested: 1, totals: [] }, "/u")?.title).toBe("החזר אחד לבדיקה");
    const two = utilityRefundsRow({ notRefunded: 3, suggested: 0, totals: [{ currency: "ILS", minor: 100n }, { currency: "USD", minor: 100n }] }, "/u");
    expect(two?.tag).toBe("3 חשבונות");
  });

  it("parses count_utility_refunds and refuses a wrong shape", () => {
    expect(parseUtilityRefundCount({ as_of: "2026-11-09", not_refunded_count: 2, suggested_count: 1, not_refunded_by_currency: [{ currency: "USD", amount_minor: 17_440 }] }))
      .toEqual({ notRefunded: 2, suggested: 1, totals: [{ currency: "USD", minor: 17_440n }] });
    expect(() => parseUtilityRefundCount({ not_refunded_count: -1, suggested_count: 0 })).toThrow();
    expect(() => parseUtilityRefundCount(null)).toThrow();
  });
});

describe("the cards", () => {
  it("groups by property, suggestions first, and says why and when", () => {
    const groups = refundGroups(utilityRefundsSample());
    expect(groups.map((group) => [group.name, group.cards.length, group.open.length])).toEqual([["דירת הגפן 3", 1, 2], ["Pine Ave 4", 1, 2]]);
    const [gefen, pine] = groups;
    expect(gefen && cardWhy(gefen.cards[0] as never)).toBe("השכירות $1,800 + החשבון $84.20");
    expect(pine && cardWhy(pine.cards[0] as never)).toBe("אותו סכום · התשלום בלי פרויקט");
    expect(pine && paymentMeta(pine.cards[0] as never)).toBe("בלי פרויקט · הכנסה אחרת · 12/09 · 7 ימים אחרי");
  });

  it("shows the summary, the figure and both properties", async () => {
    renderScreen();
    expect(await screen.findByText("4 לא הוחזרו · 2 לבדיקה")).toBeTruthy();
    expect(document.querySelector(".ui-urf-figure")?.textContent).toBe("−$295.39");
    expect(screen.getAllByRole("region", { name: /החזר אפשרי/ })).toHaveLength(2);
    expect(screen.getByText("לא הוחזר · 90 ימים · 11/08 · חודש בלי שכירות")).toBeTruthy();
  });

  it("limits the list to one property with ?project=", async () => {
    renderScreen(`/utility-refunds?project=${PINE}`);
    expect(await screen.findByText("2 לא הוחזרו · 1 לבדיקה")).toBeTruthy();
    expect(screen.queryByText("Gas Co")).toBeNull();
  });

  it("filters to לבדיקה and to לא הוחזרו", async () => {
    renderScreen();
    await screen.findByText("4 לא הוחזרו · 2 לבדיקה");
    fireEvent.click(screen.getByRole("radio", { name: "לבדיקה" }));
    expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
    expect(screen.getAllByRole("region", { name: /החזר אפשרי/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "לא הוחזרו" }));
    expect(screen.queryByRole("region", { name: /החזר אפשרי/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^ראיתי:/ })).toHaveLength(4);
  });

  it("gives a viewer no answers", async () => {
    db.hold = true;
    renderScreen();
    await screen.findByText("4 לא הוחזרו · 2 לבדיקה");
    expect(screen.queryByRole("button", { name: "כן, זה ההחזר" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "סימון הכל כנראה" })).toBeNull();
  });
});

describe("the answers and their ביטול", () => {
  it("כן on a refund in its own category matches it; ביטול takes the answer back", async () => {
    db.bills = utilityRefundsSample().map((bill) => (bill.bill_transaction_id === "b-power-pine" ? { ...bill, wrong_category: false } : bill));
    renderScreen(`/utility-refunds?project=${PINE}`);
    fireEvent.click(await screen.findByRole("button", { name: "כן, זה ההחזר" }));
    expect(await screen.findByText("Power Co · סומן כהוחזר")).toBeTruthy();
    expect(calls("answer_utility_refund")).toEqual([{ p_bill_transaction_id: "b-power-pine", p_state: "matched", p_payment_transaction_id: "pay-zelle-b" }]);
    expect(screen.queryByRole("region", { name: /החזר אפשרי/ })).toBeNull();
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")).toHaveLength(2); });
    expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-power-pine", p_state: null, p_payment_transaction_id: "pay-zelle-b" });
    expect(await screen.findByRole("region", { name: /החזר אפשרי/ })).toBeTruthy();
  });

  it("כן on a payment filed elsewhere keeps the card with the note and the fix; ביטול asks again", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "כן, זה ההחזר" }));
    expect(await screen.findByText("ייתכן שסווג לא נכון")).toBeTruthy();
    expect(screen.getByRole("button", { name: "פיצול והחזר לחשמל ומים" })).toBeTruthy();
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-water-gefen", p_state: null, p_payment_transaction_id: "pay-zelle-a" }); });
    expect(await screen.findByRole("button", { name: "כן, זה ההחזר" })).toBeTruthy();
  });

  it("לא rejects the pair; ביטול takes it back", async () => {
    renderScreen(`/utility-refunds?project=${PINE}`);
    fireEvent.click(await screen.findByRole("button", { name: "לא" }));
    expect(await screen.findByText("לא נציע את התשלום הזה שוב")).toBeTruthy();
    expect(calls("answer_utility_refund")).toEqual([{ p_bill_transaction_id: "b-power-pine", p_state: "rejected", p_payment_transaction_id: "pay-zelle-b" }]);
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-power-pine", p_state: null, p_payment_transaction_id: "pay-zelle-b" }); });
  });

  it("the fix refiles the payment; ביטול undoes the refile and the card shows the fix again", async () => {
    db.bills = utilityRefundsSample().map((bill) => (bill.bill_transaction_id === "b-water-gefen" ? { ...bill, state: "refunded" as const, source: "owner" as const } : bill));
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "פיצול והחזר לחשמל ומים" }));
    expect(await screen.findByText("נרשם כהחזר בחשמל ומים")).toBeTruthy();
    expect(calls("refile_utility_refund")).toEqual([{ p_bill_transaction_id: "b-water-gefen", p_payment_transaction_id: "pay-zelle-a" }]);
    await undo();
    await waitFor(() => { expect(calls("undo_utility_refile")).toEqual([{ p_bill_transaction_id: "b-water-gefen", p_payment_transaction_id: "pay-zelle-a" }]); });
    expect(await screen.findByText("ייתכן שסווג לא נכון")).toBeTruthy();
  });

  it("להשאיר keeps the books and hides the card on this device; ביטול shows it", async () => {
    db.bills = utilityRefundsSample().map((bill) => (bill.bill_transaction_id === "b-water-gefen" ? { ...bill, state: "refunded" as const, source: "owner" as const } : bill));
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "להשאיר" }));
    expect(await screen.findByText("נשאר כמו שהוא")).toBeTruthy();
    expect(screen.queryByText("ייתכן שסווג לא נכון")).toBeNull();
    expect(db.rpcs.filter((call) => call.name.includes("utility"))).toEqual([]);
    await undo();
    expect(await screen.findByText("ייתכן שסווג לא נכון")).toBeTruthy();
  });

  it("✓ is ראיתי; ביטול takes the bill's answer back", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Gas Co" }));
    expect(await screen.findByText("Gas Co · ראיתי")).toBeTruthy();
    expect(calls("answer_utility_refund")).toEqual([{ p_bill_transaction_id: "b-gas-gefen", p_state: "seen" }]);
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-gas-gefen", p_state: null }); });
    expect(await screen.findByRole("button", { name: "ראיתי: Gas Co" })).toBeTruthy();
  });

  it("סימון הכל כנראה closes the property's bills; ביטול unmarks the ones it closed", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "סימון הכל כנראה" }));
    expect(await screen.findByText("דירת הגפן 3 · 2 סומנו כנראה")).toBeTruthy();
    expect(calls("mark_utility_refunds_seen")).toEqual([{ p_project_id: GEFEN }]);
    expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
    await undo();
    await waitFor(() => { expect(calls("unmark_utility_refunds_seen")).toEqual([{ p_bill_transaction_ids: ["b-power-gefen", "b-gas-gefen"] }]); });
    expect(await screen.findAllByRole("button", { name: /^ראיתי:/ })).toHaveLength(2);
  });

  it("the sheet's החברה משלמת תמיד makes the utility company-paid; ביטול puts the payer back", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    const [row] = await screen.findAllByRole("button", { name: /^Gas Co/ });
    fireEvent.click(row as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "החברה משלמת תמיד · Gas Co" }));
    expect(await screen.findByText("Gas Co בדירת הגפן 3 · החברה משלמת")).toBeTruthy();
    expect(calls("set_utility_payer")).toEqual([{ p_project_id: GEFEN, p_supplier_id: "s-Gas Co", p_currency: "USD", p_payer: "company", p_added: false }]);
    await undo();
    await waitFor(() => { expect(calls("set_utility_payer")[1]).toEqual({ p_project_id: GEFEN, p_supplier_id: "s-Gas Co", p_currency: "USD", p_payer: null, p_added: false }); });
  });

  it("the sheet's הוחזר · בחירת התשלום matches the payment picked; ביטול takes it back", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    const [row] = await screen.findAllByRole("button", { name: /^Power Co/ });
    fireEvent.click(row as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "הוחזר · בחירת התשלום" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Tenant A/ }));
    expect(await screen.findByText("Power Co · סומן כהוחזר")).toBeTruthy();
    expect(calls("answer_utility_refund")).toEqual([{ p_bill_transaction_id: "b-power-gefen", p_state: "matched", p_payment_transaction_id: "pay-picked" }]);
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-power-gefen", p_state: null, p_payment_transaction_id: "pay-picked" }); });
  });

  it("a failed write puts the row back and says what failed", async () => {
    db.fail = true;
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Net Co" }));
    expect(await screen.findByText("הסימון לא נשמר. אפשר לנסות שוב.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ראיתי: Net Co" })).toBeTruthy();
  });
});
