import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_COMPOSER_ACCOUNTS,
  SAMPLE_COMPOSER_PROJECTS,
  SAMPLE_COPIES,
  SAMPLE_JEV_START,
  SAMPLE_LOAN_LINE,
  SAMPLE_SUGGESTION,
  SAMPLE_UNBALANCED_START,
} from "../dev/journal-composer-sample";
import type { ComposerApi } from "../line-composer-api";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { initialComposer, JournalComposerScreen, type ComposerState } from "./journal-composer-screen";
import { journalEditable } from "./transaction-journal";

/** FLOW-955. The composer: save waits for a balanced entry, books it, and keeps a refused entry. Invented data. */
function renderComposer(initial: ComposerState, api: ComposerApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/transactions/t-loan/journal"]}>
            <Routes>
              <Route
                path="/transactions/:transactionId/journal"
                element={(
                  <JournalComposerScreen
                    sample={{
                      line: SAMPLE_LOAN_LINE,
                      accounts: SAMPLE_COMPOSER_ACCOUNTS,
                      projects: SAMPLE_COMPOSER_PROJECTS,
                      suggestion: SAMPLE_SUGGESTION,
                      copies: SAMPLE_COPIES,
                      initial,
                      api,
                    }}
                  />
                )}
              />
              <Route path="/transactions/:transactionId" element={<h1>השורה</h1>} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The composer's balance line (the toast host is a status too). */
const balance = () => document.querySelector(".ui-jc-status")?.textContent;

const api = (save: ComposerApi["save"] = vi.fn(() => Promise.resolve({ transactionId: "t-loan", before: [] }))): ComposerApi => ({ save, undo: vi.fn(() => Promise.resolve()) });

describe("the journal entry composer", () => {
  it("opens on Jev's suggestion, balanced, and books it", async () => {
    const save = vi.fn(() => Promise.resolve({ transactionId: "t-loan", before: [] }));
    renderComposer(SAMPLE_JEV_START, api(save));
    expect(screen.getByRole("radio", { name: /הצעה של Jev/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/על בסיס 3 תנועות קודמות של Example Lending/)).toBeInTheDocument();
    expect(balance()).toBe("מאוזן · $206,000 בחובה ובזכות");
    expect(screen.getByText("שורה 1 · מהתנועה, לא משתנה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירת הפקודה" }));
    await waitFor(() => { expect(save).toHaveBeenCalledTimes(1); });
    expect(save).toHaveBeenCalledWith([
      { account_id: "a-bank", amount_minor: 20_000_000 },
      { account_id: "a-closing", amount_minor: 600_000, project_id: "p-herz" },
      { account_id: "a-loan", amount_minor: -20_600_000, project_id: "p-herz" },
    ]);
    expect(await screen.findByText("הפקודה נשמרה")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "השורה" })).toBeInTheDocument();
  });

  it("keeps save off while the sides differ, and says what is missing", () => {
    const save = vi.fn();
    renderComposer(SAMPLE_UNBALANCED_START, api(save));
    expect(balance()).toBe("חסרים $6,000 בזכות");
    const button = screen.getByRole("button", { name: "שמירת הפקודה" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(save).not.toHaveBeenCalled();
  });

  it("balances once the short side is fixed", () => {
    renderComposer(SAMPLE_UNBALANCED_START, api());
    fireEvent.change(screen.getByRole("textbox", { name: "סכום, הלוואה · Example" }), { target: { value: "206000" } });
    expect(balance()).toBe("מאוזן · $206,000 בחובה ובזכות");
    expect(screen.getByRole("button", { name: "שמירת הפקודה" })).toBeEnabled();
  });

  it("starts from scratch with one empty line, and + שורה נוספת adds the short side", () => {
    renderComposer(SAMPLE_JEV_START, api());
    fireEvent.click(screen.getByRole("button", { name: "התחלה מאפס" }));
    expect(screen.getByText("עריכה חופשית")).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /^שורה \d$/ })).toHaveLength(1);
    expect(balance()).toBe("חסרים $200,000 בזכות");
    fireEvent.click(screen.getByRole("button", { name: "+ שורה נוספת" }));
    expect(screen.getAllByRole("region", { name: /^שורה \d$/ })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "סכום, שורה 3" })).toHaveValue("200,000");
  });

  it("a refused save keeps the entry and says why", async () => {
    renderComposer(SAMPLE_JEV_START, api(vi.fn(() => Promise.reject(new Error("line has an open review")))));
    fireEvent.click(screen.getByRole("button", { name: "שמירת הפקודה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("התנועה ממתינה לאישור. אשרו אותה קודם.");
    expect(screen.getByRole("button", { name: "שמירת הפקודה" })).toBeEnabled();
  });

  it("a line's side switch moves its amount to the other side", () => {
    renderComposer(SAMPLE_JEV_START, api());
    const sides = screen.getAllByRole("radiogroup", { name: "צד בפקודה" });
    const first = sides[0];
    if (first == null) throw new Error("side");
    fireEvent.click(first.querySelectorAll("button")[1] as HTMLButtonElement);
    expect(balance()).toBe("חסרים $12,000 בחובה");
  });
});

describe("which lines get עריכה", () => {
  const plain = { vat_amount: 0n, loan_split: null, in_pnl_override: null, review_status: "approved" as const, review_reason: null };
  it("a plain posted line, and one whose split no longer matches the bank", () => {
    expect(journalEditable(plain)).toBe(true);
    expect(journalEditable({ ...plain, review_status: "open", review_reason: "split_mismatch" })).toBe(true);
  });

  it("not a line book_line always refuses: VAT, a loan split, a manual P&L switch, an open review", () => {
    expect(journalEditable({ ...plain, vat_amount: 1_700n })).toBe(false);
    expect(journalEditable({ ...plain, loan_split: { loan_id: "l1", loan_name: null, needs_review: false, by_parts: true, parts: [] } })).toBe(false);
    expect(journalEditable({ ...plain, in_pnl_override: false })).toBe(false);
    expect(journalEditable({ ...plain, in_pnl_override: true })).toBe(false);
    expect(journalEditable({ ...plain, review_status: "open", review_reason: "missing_project" })).toBe(false);
  });
});

describe("where the composer opens", () => {
  it("on the entry booked now when it has two lines or more, else on Jev's suggestion", () => {
    expect(initialComposer(SAMPLE_JEV_START.legs, SAMPLE_SUGGESTION).start).toBe("free");
    expect(initialComposer([], SAMPLE_SUGGESTION).start).toBe("jev");
    expect(initialComposer([], null)).toEqual({ start: "free", legs: [], copied: null });
  });
});
