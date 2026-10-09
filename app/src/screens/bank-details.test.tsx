import type { ReviewRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TxnMeta } from "../txn-meta";
import { BankDetails } from "../ui/bank-details";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ReviewQueue, TransactionScreen } from "./flow-screens";

const db = vi.hoisted(() => ({
  meta: [] as unknown,
  metaError: false,
  calls: [] as Array<{ name: string; args: unknown }>,
}));

function table() {
  const result = { data: null, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "x" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: () => table(),
    rpc: (name: string, args?: unknown) => {
      db.calls.push({ name, args });
      if (name === "get_transaction") return Promise.resolve({ data: transaction, error: null });
      if (name === "get_line_meta") {
        return Promise.resolve(db.metaError ? { data: null, error: { message: "meta down" } } : { data: db.meta, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve("x") }));

const transaction = {
  id: "tx",
  description: "EXAMPLE OFFICE SUITE",
  direction: "expense",
  doc_date: "2026-09-12",
  amount_gross: "-125000",
  amount_net: "-125000",
  vat_amount: "0",
  vat_status: "source",
  currency: "USD",
  source: "mercury",
  project_id: "p1",
  project_name: "Cedar Lot",
  category_id: "c1",
  category_name: "Office",
  supplier_name: "Example Office Suite",
  customer_name: null,
};

const empty: TxnMeta = {
  transaction_id: "tx",
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/transactions/tx"]}>
            <Routes>
              <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  db.meta = [];
  db.metaError = false;
  db.calls = [];
  vi.restoreAllMocks();
});

describe("transaction פרטי הבנק (FLOW-304)", () => {
  it("shows no section when the line has no bank details, and the VAT hint no longer names the bank line", async () => {
    db.meta = [empty];
    renderDetail();
    expect(await screen.findByText("Example Office Suite")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(db.calls.some((call) => call.name === "get_line_meta")).toBe(true);
    });
    expect(db.calls.find((call) => call.name === "get_line_meta")?.args).toEqual({ p_ids: ["tx"] });
    expect(screen.queryByRole("heading", { name: "פרטי הבנק" })).not.toBeInTheDocument();
    expect(screen.queryByText(/שורת הבנק/)).not.toBeInTheDocument();
  });

  it("renders the rows in order and hides a counterparty equal to the party", async () => {
    db.meta = [{
      ...empty,
      method: "card",
      card_last4: "4242",
      account: "Mercury Checking (1)",
      counterparty: " example office suite ",
      memo: "Invoice 1042",
      bank_description: "EXAMPLE OFFICE SUITE 123456789",
    }];
    renderDetail();
    const heading = await screen.findByRole("heading", { name: "פרטי הבנק" });
    const section = heading.closest("section") as HTMLElement;
    expect(section).toHaveAccessibleName("פרטי הבנק");
    const rows = Array.from(section.querySelectorAll(".ui-row"));
    expect(rows.map((row) => row.querySelector(".ui-row-hint")?.textContent)).toEqual(["אמצעי תשלום", "חשבון", "הערה", "תיאור בבנק"]);
    expect(within(section).getByText("כרטיס שמסתיים ב־4242")).toHaveClass("sr-only");
    expect(within(section).getByText("Mercury Checking (1)")).toBeInTheDocument();
    expect(within(section).queryByText("נמען")).not.toBeInTheDocument();
    expect(within(section).getByText("EXAMPLE OFFICE SUITE ••6789")).toHaveAttribute("dir", "auto");
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a פרטי הבנק retry row when the meta read fails, and the rows after a retry", async () => {
    db.metaError = true;
    renderDetail();
    expect(await screen.findByText("Example Office Suite")).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: פרטי הבנק" }, { timeout: 4000 });
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "פרטי הבנק" })).not.toBeInTheDocument();
    db.metaError = false;
    db.meta = [{ ...empty, method: "ach" }];
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "פרטי הבנק" })).toBeInTheDocument();
    expect(screen.getByText("העברת ACH")).toBeInTheDocument();
  });
});

describe("BankDetails rows", () => {
  it("shows a different counterparty as נמען or משלם, and splits the account's last 4", () => {
    const meta: TxnMeta = { ...empty, method: "ach", account: "Mercury Checking ••1234", counterparty: "Sample Supplies LLC" };
    const { rerender } = render(<BankDetails meta={meta} party="Example Office Suite" direction="expense" />);
    expect(screen.getByText("נמען")).toBeInTheDocument();
    expect(screen.getByText("העברת ACH")).toBeInTheDocument();
    expect(screen.getByText("Mercury Checking")).toHaveClass("ui-bank-account-name");
    expect(screen.getByText("••1234")).toHaveClass("ui-num");
    rerender(<BankDetails meta={meta} party="Example Office Suite" direction="income" />);
    expect(screen.getByText("משלם")).toBeInTheDocument();
  });

  it("renders nothing for other with no other field", () => {
    const { container } = render(<BankDetails meta={{ ...empty, method: "other" }} party="x" direction="expense" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("turns a memo past 4 lines into a הערה toggle", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    render(<BankDetails meta={{ ...empty, memo: "A long memo" }} party="x" direction="expense" />);
    const toggle = screen.getByRole("button", { name: /הערה/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

const reviewRow: ReviewRow = {
  id: "r1",
  transaction_id: "tx",
  description: "EXAMPLE OFFICE SUITE",
  doc_date: "2026-09-12",
  amount_net: -125_000n,
  direction: "expense",
  reason: null,
  project_id: null,
  category_id: null,
  supplier_name: "Example Office Suite",
  project_name: null,
  category_name: null,
  project_suggested: false,
  category_suggested: false,
};

describe("review card meta (FLOW-304)", () => {
  it("reads the current card's bank details and shows the card line", async () => {
    db.meta = [{ ...empty, method: "card", card_last4: "4242" }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[reviewRow]} search="" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("כרטיס שמסתיים ב־4242")).toHaveClass("sr-only");
    // FLOW-322: the queue holds bank lines too, not only documents.
    expect(screen.getByText("תנועות שמחכות לשיוך")).toBeInTheDocument();
    expect(db.calls.filter((call) => call.name === "get_line_meta").map((call) => call.args)).toEqual([{ p_ids: ["tx"] }]);
  });
});
