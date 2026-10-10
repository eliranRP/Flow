import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TransactionLoanSplit } from "@flow/shared";
import { ToastProvider } from "../ui/toast";
import { LoanCategoryRow } from "./loan-match-row";
import { LoanMatchSampleProvider, type LoanMatchApi, type SavePart } from "./loan-match-api";

// FLOW-106 §3.4. Invented data: a 6,200 payment on an invented loan, parts 4,150 / 1,630 / 380 / 40.
const SPLIT: TransactionLoanSplit = {
  loan_id: "loan-1",
  loan_name: "משכנתא לדוגמה",
  needs_review: false,
  by_parts: true,
  parts: [
    { part: "interest", amount_minor: 163_000n, in_pnl: true },
    { part: "escrow", amount_minor: 38_000n, in_pnl: true },
    { part: "principal", amount_minor: 415_000n, in_pnl: false },
    { part: "fees", amount_minor: 4_000n, in_pnl: true },
  ],
};

function api(saves: Array<{ loanId: string; parts: SavePart[] }>, { needsReview = false, balanceMinor = 90_000_000n } = {}): LoanMatchApi {
  const scheduled: Record<string, bigint> = { interest: 160_000n, escrow: 38_000n, principal: 418_000n, fees: 4_000n };
  const categories: Record<string, string> = { interest: "cat-i", escrow: "cat-e", principal: "cat-p", fees: "cat-f" };
  return {
    read: () => Promise.resolve({
      companyId: "co-1",
      lineMinor: 620_000n,
      currency: "ILS",
      splits: [],
      byParts: true,
      loans: [{
        id: "loan-1",
        name: "משכנתא לדוגמה",
        currency: "ILS",
        principalMinor: 100_000_000,
        annualRatePpm: 50_000,
        termMonths: 360,
        startDate: "2026-01-01",
        paymentMinor: 620_000,
        escrowMinor: 38_000,
        balanceMinor,
        categoryIds: { principal: "cat-p", fees: "cat-f" },
      }],
      categoryIds: {},
    }),
    readStored: () => Promise.resolve({
      lineMinor: 620_000n,
      currency: "ILS",
      loanCurrency: "ILS",
      parts: SPLIT.parts.map((part) => ({
        part: part.part,
        amountMinor: part.amount_minor,
        scheduledMinor: scheduled[part.part] ?? 0n,
        categoryId: categories[part.part] ?? null,
        needsReview,
      })),
    }),
    readCategories: () => Promise.resolve([
      { id: "cat-f", name: "עמלות בנק", kind: "expense", loanPart: null, excludedFromPnl: false, hidden: false },
    ]),
    save: (_transactionId, loanId, parts) => {
      saves.push({ loanId, parts });
      return Promise.resolve();
    },
    clear: () => Promise.reject(new Error("unused")),
  };
}

function renderRow(loanApi: LoanMatchApi, { needsReview = false, dated = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <LoanMatchSampleProvider api={loanApi} initial={{ ...SPLIT, needs_review: needsReview }} loanNames={{ "loan-1": "משכנתא לדוגמה" }}>
            <LoanCategoryRow transactionId="tx" split={SPLIT} direction="expense" active readOnly={false} docDate={dated ? "2026-10-01" : undefined}>
              <p>category row</p>
            </LoanCategoryRow>
          </LoanMatchSampleProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ }));
  const sheet = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
  const edit = within(sheet).getByRole("button", { name: "עריכת הפיצול" });
  await waitFor(() => { expect(edit).toBeEnabled(); });
  fireEvent.click(edit);
  return screen.findByRole("dialog", { name: "פיצול התשלום" });
}

describe("עריכת הפיצול on a matched line (FLOW-106 §3.4)", () => {
  it("opens the split editor on the stored parts, in exact amounts, for the matched loan only", async () => {
    renderRow(api([]));
    const editor = await openEditor();
    expect(screen.queryByRole("dialog", { name: "משכנתא לדוגמה" })).not.toBeInTheDocument();
    expect(within(editor).getByLabelText("סכום, קרן")).toHaveValue("4,150");
    expect(within(editor).getByLabelText("סכום, ריבית")).toHaveValue("1,630");
    expect(within(editor).getByLabelText("סכום, מסים וביטוח")).toHaveValue("380");
    expect(within(editor).getByLabelText("סכום, עמלות")).toHaveValue("40");
    // No schedule mode and no loan picker: the line stays on its loan.
    expect(within(editor).queryByRole("radiogroup", { name: "אופן הפיצול" })).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText("הלוואה")).not.toBeInTheDocument();
  });

  it("saves the edit with each part's stored schedule and category", async () => {
    const saves: Array<{ loanId: string; parts: SavePart[] }> = [];
    renderRow(api(saves));
    const editor = await openEditor();
    fireEvent.change(within(editor).getByLabelText("סכום, קרן"), { target: { value: "4100" } });
    fireEvent.change(within(editor).getByLabelText("סכום, ריבית"), { target: { value: "1680" } });
    fireEvent.click(within(editor).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves).toHaveLength(1); });
    expect(saves[0]).toEqual({
      loanId: "loan-1",
      parts: [
        { part: "interest", amount_minor: 168_000, scheduled_minor: 160_000, category_id: "cat-i" },
        { part: "escrow", amount_minor: 38_000, scheduled_minor: 38_000, category_id: "cat-e" },
        { part: "principal", amount_minor: 410_000, scheduled_minor: 418_000, category_id: "cat-p" },
        { part: "fees", amount_minor: 4_000, scheduled_minor: 4_000, category_id: "cat-f" },
      ],
    });
    expect(await screen.findByText("הפיצול נשמר")).toBeInTheDocument();
  });

  it("lets the principal rise up to the balance plus the principal the line already paid", async () => {
    const saves: Array<{ loanId: string; parts: SavePart[] }> = [];
    renderRow(api(saves, { balanceMinor: 10_000n }));
    const editor = await openEditor();
    fireEvent.change(within(editor).getByLabelText("סכום, קרן"), { target: { value: "4250" } });
    fireEvent.change(within(editor).getByLabelText("סכום, ריבית"), { target: { value: "1530" } });
    expect(within(editor).getByRole("button", { name: "שמירה" })).toBeEnabled();
    fireEvent.change(within(editor).getByLabelText("סכום, קרן"), { target: { value: "4260" } });
    fireEvent.change(within(editor).getByLabelText("סכום, ריבית"), { target: { value: "1520" } });
    expect(within(editor).getByText("התשלום גבוה מיתרת ההלוואה.")).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("keeps a flagged split on its own correction, with no editor link", async () => {
    renderRow(api([], { needsReview: true }), { needsReview: true });
    fireEvent.click(screen.getByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ }));
    const sheet = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(within(sheet).queryByRole("button", { name: "עריכת הפיצול" })).not.toBeInTheDocument();
  });

  it("does not offer the editor without the line's date", async () => {
    renderRow(api([]), { dated: false });
    fireEvent.click(screen.getByRole("button", { name: /^תשלום הלוואה · משכנתא לדוגמה/ }));
    const sheet = await screen.findByRole("dialog", { name: "משכנתא לדוגמה" });
    expect(within(sheet).queryByRole("button", { name: "עריכת הפיצול" })).not.toBeInTheDocument();
  });
});
