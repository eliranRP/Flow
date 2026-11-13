import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityRefundsRow } from "./attention-rows";
import { refundWindowStart } from "./utility-refund-sheet";
import { UtilityRefundsScreen } from "./utility-refunds-screen";
import { GEFEN, PINE, utilityRefundsSample, utilitySplitSample } from "./utility-refunds-sample";
import { FOLD_MS } from "../ui/fold";
import { ToastProvider } from "../ui/toast";
import { parseUtilityRefundCount } from "../utility-refund-count";
import { fixCopy, paymentMeta, paymentsTaken, refundDate, refundGroups } from "../utility-refund-view";
import type { UtilityBill } from "../utility-refunds";
import { utilityRefundsSchema } from "../utility-refund-schema";

// FLOW-1135 (decision 0265): החזרי חשבונות. Home's row, the cards, and every live answer with its ביטול.
const db = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: unknown }>,
  fail: false,
  hold: false,
  bills: [] as unknown[],
  /** Every bill with its state (the picker's read, p_all). */
  all: [] as unknown[],
}));

vi.mock("../utility-refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utility-refunds")>();
  return {
    ...actual,
    useUtilityRefundsQuery: (_project: string | null, _active?: boolean, all?: boolean) => useQuery({
      queryKey: ["utility-refunds", "off", "", all === true ? "all" : "open"],
      queryFn: () => Promise.resolve({ as_of: "2026-11-09", bills: (all === true ? db.all : db.bills) as UtilityBill[] }),
    }),
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
  db.all = [];
  window.localStorage.clear();
});

/** A bill row's line (FLOW-1153: whole parts, so its text spans the parts). */
const hintText = (text: string) => (_: string, element: Element | null) => element?.classList.contains("ui-hint-wrap") === true && element.textContent === text;

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
    const row = utilityRefundsRow({ notRefunded: 4, totals: [{ currency: "USD", minor: 29_539n }] }, "/utility-refunds?preview=1");
    expect(row?.to).toBe("/utility-refunds?preview=1");
    expect(row?.tag).toBe("$295.39");
    expect(row?.dismissKey).toBe("utility-refunds:4:USD29539");
    render(<p>{row?.title}</p>);
    expect(screen.getByText(/חשבונות לא הוחזרו/).textContent).toBe("4 חשבונות לא הוחזרו · $295.39");
    const one = utilityRefundsRow({ notRefunded: 1, totals: [{ currency: "USD", minor: 4_600n }] }, "/utility-refunds");
    render(<p>{one?.title}</p>);
    expect(screen.getByText(/חשבון אחד לא הוחזר/).textContent).toBe("חשבון אחד לא הוחזר · $46");
  });

  it("shows only when a bill is not refunded (FLOW-1143: no לבדיקה variant); two currencies show the count", () => {
    expect(utilityRefundsRow({ notRefunded: 0, totals: [] }, "/u")).toBeNull();
    const two = utilityRefundsRow({ notRefunded: 3, totals: [{ currency: "ILS", minor: 100n }, { currency: "USD", minor: 100n }] }, "/u");
    expect(two?.tag).toBe("3 חשבונות");
  });

  it("parses count_utility_refunds and refuses a wrong shape", () => {
    // FLOW-1143: no suggested_count is needed (an older server's is ignored).
    expect(parseUtilityRefundCount({ as_of: "2026-11-09", not_refunded_count: 2, not_refunded_by_currency: [{ currency: "USD", amount_minor: 17_440 }] }))
      .toEqual({ notRefunded: 2, totals: [{ currency: "USD", minor: 17_440n }] });
    expect(parseUtilityRefundCount({ not_refunded_count: 1, suggested_count: 3, not_refunded_by_currency: [] })).toEqual({ notRefunded: 1, totals: [] });
    expect(() => parseUtilityRefundCount({ not_refunded_count: -1 })).toThrow();
    expect(() => parseUtilityRefundCount(null)).toThrow();
  });
});

describe("the cards", () => {
  it("leaves out a refund the owner kept as filed", () => {
    const kept = utilityRefundsSample().map((bill) => (bill.bill_transaction_id === "b-water-gefen" ? { ...bill, state: "refunded" as const, source: "owner" as const, keep_category: true } : bill));
    expect(refundGroups(kept).find((group) => group.projectId === GEFEN)?.cards).toEqual([]);
  });

  it("groups by property, the fix cards first, and words each fix and when", () => {
    const groups = refundGroups(utilityRefundsSample());
    expect(groups.map((group) => [group.name, group.cards.length, group.open.length])).toEqual([["דירת הגפן 3", 1, 2], ["Pine Ave 4", 1, 2]]);
    const [gefen, pine] = groups;
    // The rent with the bill is split; a payment the size of the bill moves whole.
    expect(gefen && fixCopy(gefen.cards[0] as never).label).toBe("פיצול והחזר לחשמל ומים");
    expect(pine && fixCopy(pine.cards[0] as never).label).toBe("העברה לחשמל ומים כהחזר");
    expect(pine && paymentMeta(pine.cards[0] as never)).toBe("בלי פרויקט · הכנסה אחרת · 12/09/26 · 7 ימים אחרי");
  });

  it("shows the summary, the figure and both properties", async () => {
    renderScreen();
    expect(await screen.findByText("4 לא הוחזרו")).toBeTruthy();
    expect(document.querySelector(".ui-urf-figure")?.textContent).toBe("−$295.39");
    expect(screen.getAllByRole("region", { name: /החזר לתיקון/ })).toHaveLength(2);
    expect(screen.getByText(hintText("לא הוחזר · 90 ימים · 11/08/26 · חודש בלי שכירות"))).toBeTruthy();
  });

  it("links each property's head to its bills by type, a viewer too (FLOW-1159)", async () => {
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    expect(screen.getAllByRole("link", { name: "כל החשבונות" }).map((link) => link.getAttribute("href"))).toEqual([
      `/projects/${GEFEN}/utilities/bills`,
      `/projects/${PINE}/utilities/bills`,
    ]);
  });

  it("a bill's sheet shows its status and the way into the income around it (FLOW-1159)", async () => {
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    fireEvent.click(screen.getByRole("button", { name: /^Gas Co/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("לא הוחזר · 81 ימים", { selector: "p" })).toBeTruthy();
    expect((await within(dialog).findByRole("link", { name: /מה נכנס סביב החשבון הזה/ })).getAttribute("href")).toBe(`/projects/${GEFEN}/utilities/bills/b-gas-gefen/income`);
  });

  it("limits the list to one property with ?project=", async () => {
    renderScreen(`/utility-refunds?project=${PINE}`);
    // The page's line and the property's head.
    expect(await screen.findAllByText("2 לא הוחזרו")).toHaveLength(2);
    expect(screen.queryByText("Gas Co")).toBeNull();
  });

  it("gives a viewer no answers", async () => {
    db.hold = true;
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    expect(screen.queryByRole("button", { name: "להשאיר" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "סימון הכל כנראה" })).toBeNull();
  });
});

describe("opening a transaction (FLOW-1142)", () => {
  const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

  it("each leg of a card opens its own transaction: the bill and the payment", async () => {
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    const card = screen.getAllByRole("region", { name: /החזר לתיקון: City Water/ })[0] as HTMLElement;
    const legs = within(card).getAllByRole("link");
    expect(legs.map((leg) => leg.getAttribute("href"))).toEqual(["/transactions/b-water-gefen", "/transactions/pay-zelle-a"]);
    expect(href(/^Tenant B · /)).toBe("/transactions/pay-zelle-b");
  });

  it("a payment for several bills lists each bill as its own leg, each opening its transaction", async () => {
    const [first] = utilityRefundsSample();
    const pay = first?.payment;
    db.bills = [
      first,
      { ...first, bill_transaction_id: "b-gas-pair", supplier_name: "Gas Co", category_name: "גז", amount_minor: 4_000n, payment: pay },
    ];
    renderScreen();
    const card = await screen.findByRole("region", { name: "החזר לתיקון: City Water + Gas Co" });
    expect(within(card).getAllByRole("link").map((leg) => leg.getAttribute("href"))).toEqual([
      "/transactions/b-water-gefen", "/transactions/b-gas-pair", "/transactions/pay-zelle-a",
    ]);
    expect(within(card).getByText("גז · 14/09/26")).toBeTruthy();
  });

  it("the bill's sheet opens its transaction", async () => {
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    fireEvent.click(screen.getByRole("button", { name: /^Gas Co/ }));
    expect((await screen.findByRole("link", { name: "פתיחת התנועה" })).getAttribute("href")).toBe("/transactions/b-gas-gefen");
  });

  it("a viewer's bill row opens its transaction", async () => {
    db.hold = true;
    renderScreen();
    await screen.findByText("4 לא הוחזרו");
    expect(href(/^Gas Co/)).toBe("/transactions/b-gas-gefen");
  });
});

describe("the answers and their ביטול", () => {
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

  it("להשאיר keeps the payment's category (the server's keep); ביטול drops the keep and the fix shows again", async () => {
    db.bills = utilityRefundsSample().map((bill) => (bill.bill_transaction_id === "b-water-gefen" ? { ...bill, state: "refunded" as const, source: "owner" as const } : bill));
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "להשאיר" }));
    expect(await screen.findByText("נשאר כמו שהוא")).toBeTruthy();
    await waitFor(() => { expect(screen.queryByText("ייתכן שסווג לא נכון")).toBeNull(); });
    expect(calls("answer_utility_refund")).toEqual([{ p_bill_transaction_id: "b-water-gefen", p_state: "matched", p_payment_transaction_id: "pay-zelle-a", p_keep_category: true }]);
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")[1]).toEqual({ p_bill_transaction_id: "b-water-gefen", p_state: "matched", p_payment_transaction_id: "pay-zelle-a", p_keep_category: false }); });
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
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull(); });
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

  it("each opening of a bill starts on its actions, never on the picker left open", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    const [row] = await screen.findAllByRole("button", { name: /^Power Co/ });
    fireEvent.click(row as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "הוחזר · בחירת התשלום" }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: /Tenant A/ }));
    await undo();
    const [again] = await screen.findAllByRole("button", { name: /^Power Co/ });
    fireEvent.click(again as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "ראיתי, אין צורך בטיפול" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "החברה משלמת תמיד · Power Co" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "הוחזר · בחירת התשלום" })).toBeTruthy();
  });

  it("the picker leaves out a payment already another property's or month's refund, and keeps one of the same month", async () => {
    const [power] = utilityRefundsSample().filter((bill) => bill.bill_transaction_id === "b-power-gefen");
    const refunded = (over: Partial<UtilityBill>): UtilityBill => ({
      ...(power as UtilityBill), bill_transaction_id: "b-other", state: "refunded", source: "owner",
      payment: { transaction_id: "pay-picked", doc_date: "2026-10-01", amount_minor: 12_840n, currency: "USD", description: "Zelle", party: "Tenant A", project_id: GEFEN, category_id: "c-rent", project_name: "דירת הגפן 3", category_name: "שכירות", split: false, parts: [] },
      ...over,
    });
    db.all = [refunded({ project_id: PINE })];
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    const [row] = await screen.findAllByRole("button", { name: /^Power Co/ });
    fireEvent.click(row as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "הוחזר · בחירת התשלום" }));
    expect(await screen.findByText("אין תשלומים שנכנסו מחודש לפני החשבון ועד היום.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tenant A/ })).toBeNull();
    // The same property and month: one payment may refund the month's bills together.
    expect([...paymentsTaken([refunded({ doc_date: "2026-09-20" })], power as UtilityBill)]).toEqual([]);
    expect([...paymentsTaken([refunded({ doc_date: "2026-08-20" })], power as UtilityBill)]).toEqual(["pay-picked"]);
  });

  it("the picker's window starts a month before the bill, clamped to that month's last day", () => {
    expect(refundWindowStart("2026-03-31")).toBe("2026-02-28");
    expect(refundWindowStart("2024-03-30")).toBe("2024-02-29");
    expect(refundWindowStart("2026-01-31")).toBe("2025-12-31");
    expect(refundWindowStart("2026-11-15")).toBe("2026-10-15");
  });

  it("a failed write puts the row back and says what failed", async () => {
    db.fail = true;
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Net Co" }));
    expect(await screen.findByText("הסימון לא נשמר. אפשר לנסות שוב.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ראיתי: Net Co" })).toBeTruthy();
  });
});

// FLOW-1141 (the owner): a bill row or a card answered slides toward its ✓ and folds (ui/fold.tsx), and stays
// in the list until the fold ends; under reduced motion it goes at once; ביטול brings it back.
describe("the fold", () => {
  const item = (name: string) => screen.getByRole("button", { name }).closest(".ui-fold");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a row closed with ✓ in the list while it folds, then drops it", async () => {
    // The fold's own timer is held, so a slow runner cannot end the fold before the write's toast shows.
    const realTimeout = globalThis.setTimeout;
    const folds: (() => void)[] = [];
    vi.stubGlobal("setTimeout", ((run: () => void, ms?: number) => {
      if (ms !== FOLD_MS) return realTimeout(run, ms);
      folds.push(run);
      return 0;
    }));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Gas Co" }));
    expect(item("ראיתי: Gas Co")?.hasAttribute("data-leaving")).toBe(true);
    expect(item("ראיתי: Gas Co")?.hasAttribute("inert")).toBe(true);
    expect(await screen.findByText("Gas Co · ראיתי")).toBeTruthy();
    // The write answered; the row is still folding.
    expect(screen.getByRole("button", { name: "ראיתי: Gas Co" })).toBeTruthy();
    act(() => { for (const end of folds) end(); });
    await waitFor(() => { expect(screen.queryByRole("button", { name: "ראיתי: Gas Co" })).toBeNull(); });
  });

  it("folds every row סימון הכל כנראה closes", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "סימון הכל כנראה" }));
    expect(item("ראיתי: Power Co")?.hasAttribute("data-leaving")).toBe(true);
    expect(item("ראיתי: Gas Co")?.hasAttribute("data-leaving")).toBe(true);
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^ראיתי:/ })).toBeNull(); });
  });

  it("folds a fix card kept with להשאיר", async () => {
    renderScreen(`/utility-refunds?project=${PINE}`);
    fireEvent.click(await screen.findByRole("button", { name: "להשאיר" }));
    expect(screen.getByRole("region", { name: /החזר לתיקון/ }).closest(".ui-fold")?.hasAttribute("data-leaving")).toBe(true);
    await waitFor(() => { expect(screen.queryByRole("region", { name: /החזר לתיקון/ })).toBeNull(); });
  });

  it("ביטול mid-fold stops the fold and keeps the row", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Net Co" }));
    await undo();
    await waitFor(() => { expect(calls("answer_utility_refund")).toHaveLength(2); });
    await waitFor(() => { expect(item("ראיתי: Net Co")?.hasAttribute("data-leaving")).toBe(false); });
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    expect(screen.getByRole("button", { name: "ראיתי: Net Co" })).toBeTruthy();
  });

  it("with reduced motion the row goes at once", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"), media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "ראיתי: Gas Co" }));
    expect(screen.queryByRole("button", { name: "ראיתי: Gas Co" })).toBeNull();
    await undo();
    expect(await screen.findByRole("button", { name: "ראיתי: Gas Co" })).toBeTruthy();
  });
});

// FLOW-1141 (the owner): every date on the utility refund screens reads dd/mm/yy.
describe("the dates", () => {
  it("writes each date with its year", () => {
    expect(refundDate("2026-09-14")).toBe("14/09/26");
    expect(refundDate("2025-12-31")).toBe("31/12/25");
  });

  it("shows the bills', the payments' and the picker's dates as dd/mm/yy", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    expect(await screen.findByText(hintText("לא הוחזר · 67 ימים · 03/09/26"))).toBeTruthy();
    expect(screen.getByText("חשמל ומים · 14/09/26")).toBeTruthy();
    expect(screen.getByText("דירת הגפן 3 · שכירות · 02/10/26 · 18 ימים אחרי")).toBeTruthy();
    const [row] = screen.getAllByRole("button", { name: /^Power Co/ });
    fireEvent.click(row as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "הוחזר · בחירת התשלום" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Power Co · $128.40 · 03/09/26")).toBeTruthy();
    expect(await within(dialog).findByText("שכירות · 01/10/26")).toBeTruthy();
  });
});

// FLOW-1142 (the owner): the payment leg names the project it is filed to, and a split payment lists its parts.
describe("the payment's project and split", () => {
  it("reads a payment without the new fields as no project name and no split (before the server sends them)", () => {
    const [first] = utilityRefundsSample();
    const payment = { ...first?.payment, amount_minor: 100, project_name: undefined, parts: undefined };
    const body = { as_of: "2026-11-09", bills: [{ ...first, amount_minor: 100, payment }] };
    const parsed = utilityRefundsSchema.parse(body).bills[0]?.payment;
    expect(parsed?.project_name).toBeNull();
    expect(parsed?.parts).toEqual([]);
  });

  it("names the payment's project on its line, and its leg's name says what the leg shows", async () => {
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    expect(await screen.findByText("דירת הגפן 3 · שכירות · 02/10/26 · 18 ימים אחרי")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tenant A · דירת הגפן 3 · שכירות · 02/10/26 · 18 ימים אחרי · +$1,884.20 · פתיחת התנועה" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "City Water · חשמל ומים · 14/09/26 · −$84.20 · פתיחת התנועה" })).toBeTruthy();
  });

  it("keeps בלי פרויקט for a payment on no project", async () => {
    renderScreen(`/utility-refunds?project=${PINE}`);
    expect(await screen.findByText("בלי פרויקט · הכנסה אחרת · 12/09/26 · 7 ימים אחרי")).toBeTruthy();
  });

  it("lists a split payment's parts under its leg, with the project only where it differs", async () => {
    db.bills = utilitySplitSample();
    renderScreen(`/utility-refunds?project=${GEFEN}`);
    const card = await screen.findByRole("region", { name: /החזר לתיקון/ });
    const split = within(card).getByRole("list", { name: "פיצול" });
    // FLOW-1153: two columns, the name and its amount, with no "·" between them.
    const items = within(split).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "שכירות $1,700",
      "חשמל ומים $84.20",
      "שכירות · Pine Ave 4 $100",
    ]);
    expect(items.map((item) => item.querySelector(".ui-urf-split-amount")?.textContent)).toEqual(["$1,700", "$84.20", "$100"]);
  });

  it("says ראיתי in words on its button, not a bare ✓ (FLOW-1155)", async () => {
    renderScreen();
    const seen = await screen.findByRole("button", { name: "ראיתי: Gas Co" });
    expect(seen.textContent).toBe("ראיתי");
    expect(seen.querySelector("svg")).toBeNull();
  });

  it("shows no split for a payment that is not split", async () => {
    renderScreen();
    const cards = await screen.findAllByRole("region", { name: /החזר לתיקון/ });
    for (const card of cards) expect(within(card).queryByText("פיצול")).toBeNull();
  });
});
