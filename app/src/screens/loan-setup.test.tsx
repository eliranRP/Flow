import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { contractualPaymentMinor } from "@flow/shared";
import { dayLabel, formatDisplay, israelToday, shiftDays } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { companyLoanCurrency, firstOfNextMonth, readCompanyLoanCurrency } from "./loan-form";
import { LoanProjectPicker, LoanSettingsSection, LoanSetupForm } from "./loan-setup";

const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string; code?: string } | null,
  hold: null as Promise<void> | null,
  baseCurrency: null as string | null,
  currencyError: null as { message: string } | null,
  currencyHold: null as Promise<void> | null,
  offline: false,
  selects: 0,
  balanceError: null as { message: string } | null,
  loans: [] as Array<{ id: string; name: string; currency: string; project_id: string | null }>,
  projects: [] as Array<{ id: string; name: string }>,
  updates: [] as Array<{ row: Record<string, unknown>; id: string }>,
  updateRows: 1,
  updateError: null as { message: string; code?: string } | null,
  updateHold: null as Promise<void> | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => {
    if (db.offline) return null;
    return {
      rpc: (name: string) => {
        if (name !== "mcp_company_loan_currency") throw new Error(name);
        db.selects += 1;
        const finish = () => ({ data: db.currencyError ? null : db.baseCurrency, error: db.currencyError });
        if (db.currencyHold) return db.currencyHold.then(() => finish());
        return Promise.resolve(finish());
      },
      from: (table: string) => {
        if (table === "loans") {
          return {
            insert: (row: Record<string, unknown>) => {
              db.inserts.push(row);
              const finish = () => ({ data: null, error: db.insertError });
              if (db.hold) return db.hold.then(() => finish());
              return Promise.resolve(finish());
            },
            select: () => ({
              eq: () => Promise.resolve({ data: db.loans, error: null }),
            }),
            update: (row: Record<string, unknown>) => ({
              eq: (_column: string, id: string) => ({
                select: () => {
                  db.updates.push({ row, id });
                  const finish = () => ({
                    data: db.updateError ? null : Array.from({ length: db.updateRows }, () => ({ id })),
                    error: db.updateError,
                  });
                  if (db.updateHold) return db.updateHold.then(() => finish());
                  return Promise.resolve(finish());
                },
              }),
            }),
          };
        }
        if (table === "projects") {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: db.projects, error: null }),
            }),
          };
        }
        if (table === "loan_balances") {
          return {
            select: () => Promise.resolve({
              data: db.balanceError ? null : db.loans.map((loan) => ({ loan_id: loan.id, balance_minor: 500000, flagged_parts: 0, currency: loan.currency })),
              error: db.balanceError,
            }),
          };
        }
        throw new Error(table);
      },
    };
  },
}));

const mortgage = {
  name: "הלוואת דוגמה",
  principal: "100000",
  rate: "6",
  term: "360",
  startDate: "2026-11-01",
  escrow: "0",
};

beforeEach(() => {
  db.inserts = [];
  db.insertError = null;
  db.hold = null;
  db.baseCurrency = "ILS";
  db.currencyError = null;
  db.currencyHold = null;
  db.offline = false;
  db.selects = 0;
  db.balanceError = null;
  db.loans = [];
  db.projects = [];
  db.updates = [];
  db.updateRows = 1;
  db.updateError = null;
  db.updateHold = null;
});

function renderForm(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function sectionTree(client: QueryClient, ui: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderSection(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(sectionTree(client, ui));
  return Object.assign(view, { client });
}

function openLoan() {
  fireEvent.click(screen.getByRole("button", { name: "הלוואה חדשה" }));
}

async function expectReopenedBlank(inserts: number) {
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "הלוואה" })).not.toBeInTheDocument();
  });
  openLoan();
  expect(screen.getByLabelText("מלווה")).toHaveValue("");
  expect(screen.getByLabelText("סכום מקורי")).toHaveValue("");
  expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("");
  const save = screen.getByRole("button", { name: "שמירה" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(screen.getByText("חסר מלווה.")).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 40); });
  });
  expect(db.inserts).toHaveLength(inserts);
}

function fillSavable() {
  fireEvent.change(screen.getByLabelText("מלווה"), { target: { value: "הלוואת דוגמה" } });
  fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "100000" } });
  fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "11.2042" } });
}

describe("company currency", () => {
  it("uses dollars only for a USD company", () => {
    expect(companyLoanCurrency("USD")).toBe("USD");
    expect(companyLoanCurrency("ILS")).toBe("ILS");
    expect(companyLoanCurrency("EUR")).toBe("ILS");
  });

  it("starts the loan on the first day of next month in Jerusalem", () => {
    expect(firstOfNextMonth(new Date("2026-10-04T12:00:00Z"))).toBe("2026-11-01");
    expect(firstOfNextMonth(new Date("2026-12-15T12:00:00Z"))).toBe("2027-01-01");
  });

  it("reads the stored company currency and stays on shekels when the read fails", async () => {
    db.offline = true;
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    db.offline = false;
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    db.baseCurrency = "USD";
    expect(await readCompanyLoanCurrency()).toBe("USD");
    db.baseCurrency = null;
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    db.baseCurrency = "USD";
    db.currencyError = { message: "down" };
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    expect(db.selects).toBe(4);
  });
});

describe("LoanSetupForm", () => {
  it("moves from lender to principal on Enter without surfacing errors", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const lender = screen.getByLabelText("מלווה");
    const principal = screen.getByLabelText("סכום מקורי");
    fireEvent.change(lender, { target: { value: "בנק דוגמה" } });
    fireEvent.keyDown(lender, { key: "Enter", code: "Enter" });
    expect(principal).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/חובה|נדרש|שגוי/)).toHaveLength(0);
  });

  it("cancels Enter's implicit submit on a middle field and leaves it alone on the last", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const lender = screen.getByLabelText("מלווה");
    const escrow = screen.getByLabelText("מסים וביטוח לחודש");
    // fireEvent returns false when the handler called preventDefault (jsdom has no implicit submit).
    expect(fireEvent.keyDown(lender, { key: "Enter", code: "Enter" })).toBe(false);
    escrow.focus();
    expect(fireEvent.keyDown(escrow, { key: "Enter", code: "Enter" })).toBe(true);
    expect(escrow).toHaveFocus();
  });

  it("does not advance on other keys or while an IME composition is committing", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const lender = screen.getByLabelText("מלווה");
    lender.focus();
    expect(fireEvent.keyDown(lender, { key: "a", code: "KeyA" })).toBe(true);
    expect(lender).toHaveFocus();
    expect(fireEvent.keyDown(lender, { key: "Enter", code: "Enter", isComposing: true })).toBe(true);
    expect(lender).toHaveFocus();
  });

  it("defaults a dollar company to $ and USD", () => {
    renderForm(<LoanSetupForm companyCurrency="USD" />);
    expect(screen.getByRole("radio", { name: "$" })).toBeChecked();
    const prefixes = [...document.querySelectorAll(".ui-money-prefix")].map((node) => node.textContent);
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((mark) => mark === "$")).toBe(true);
    expect(screen.getByLabelText("תקופה בחודשים")).toHaveValue("360");
    expect(screen.getByLabelText("מסים וביטוח לחודש")).toHaveValue("0");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("defaults a shekel company to ₪", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    expect(screen.getByRole("radio", { name: "₪" })).toBeChecked();
    const prefixes = [...document.querySelectorAll(".ui-money-prefix")].map((node) => node.textContent);
    expect(prefixes.every((mark) => mark === "₪")).toBe(true);
  });

  it("puts the currency toggle under the principal and aligns the term and date with the amount", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    const principal = screen.getByLabelText("סכום מקורי");
    const currency = screen.getByRole("radiogroup", { name: "מטבע" });
    const rate = screen.getByLabelText("ריבית שנתית");
    const term = screen.getByLabelText("תקופה בחודשים");
    const date = screen.getByRole("button", { name: "תאריך תשלום ראשון" });
    expect(principal.compareDocumentPosition(currency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(currency.compareDocumentPosition(rate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(term).textAlign).toBe("right");
    expect(getComputedStyle(principal).textAlign).toBe("right");
    expect(getComputedStyle(rate).textAlign).toBe("right");
    const shown = date.querySelector(".ui-num");
    expect(shown).not.toBeNull();
    expect(getComputedStyle(shown as Element).textAlign).toBe("right");
  });

  it("opens the date sheet on the first of next month and keeps a future day", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const field = screen.getByRole("button", { name: "תאריך תשלום ראשון" });
    expect(field).toHaveTextContent(formatDisplay(firstOfNextMonth()));
    expect(document.querySelector("input[type='date']")).toBeNull();
    fireEvent.click(field);
    expect(screen.getByRole("heading", { name: "תאריך תשלום ראשון" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "היום" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אתמול" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חודש הבא" })).toBeEnabled();
    const future = shiftDays(israelToday(), 40);
    const futureName = dayLabel(future);
    for (let step = 0; step < 4 && screen.queryByRole("button", { name: futureName }) == null; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
    }
    const day = screen.getByRole("button", { name: futureName });
    expect(day).toBeEnabled();
    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(screen.getByRole("button", { name: "תאריך תשלום ראשון" })).toHaveTextContent(formatDisplay(future));
  });

  it("keeps a past day on the first-payment date with no today or yesterday shortcut", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    fireEvent.click(screen.getByRole("button", { name: "תאריך תשלום ראשון" }));
    expect(screen.queryByRole("button", { name: "היום" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אתמול" })).not.toBeInTheDocument();
    const past = shiftDays(israelToday(), -1);
    const pastName = dayLabel(past);
    for (let step = 0; step < 4 && screen.queryByRole("button", { name: pastName }) == null; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    }
    const day = screen.getByRole("button", { name: pastName });
    expect(day).toBeEnabled();
    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(screen.getByRole("button", { name: "תאריך תשלום ראשון" })).toHaveTextContent(formatDisplay(past));
  });

  it("keeps four rate decimals so 11.2042 is the saved rate", () => {
    const saved: Array<Record<string, unknown>> = [];
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        initial={mortgage}
        onSave={(row) => { saved.push(row); }}
      />,
    );
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "11.2042" } });
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("11.2042");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(saved[0]?.annual_rate_ppm).toBe(112_042);
  });

  it("keeps up to four term digits and refuses a term past 600", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    const term = screen.getByLabelText("תקופה בחודשים");
    fireEvent.change(term, { target: { value: "600" } });
    expect(term).toHaveValue("600");
    expect(screen.queryByText("התקופה היא בין חודש אחד ל־600.")).not.toBeInTheDocument();
    fireEvent.change(term, { target: { value: "1000" } });
    expect(term).toHaveValue("1000");
    expect(screen.queryByText("התקופה היא בין חודש אחד ל־600.")).not.toBeInTheDocument();
    fireEvent.blur(term);
    expect(screen.getByText("התקופה היא בין חודש אחד ל־600.")).toBeInTheDocument();
  });

  it("keeps the last preview while a field is incomplete", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "6." } });
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("6.");
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
    expect(screen.queryByText("הריבית היא עד 100%.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "" } });
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "" } });
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    expect(screen.queryByText("חסר סכום.")).not.toBeInTheDocument();
  });

  it("shows every blocking reason under its field", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        advancedOpen
        initial={{
          name: "",
          principal: "0",
          rate: "6",
          term: "",
          startDate: "2026-11-01",
          escrow: "5",
          payment: "4",
        }}
      />,
    );
    expect(screen.queryByText("חסר מלווה.")).not.toBeInTheDocument();
    expect(screen.queryByText("חסר סכום.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    const lender = screen.getByLabelText("מלווה");
    expect(document.getElementById(lender.getAttribute("aria-describedby") ?? "")).toHaveTextContent("חסר מלווה.");
    expect(screen.getByText("חסר מלווה.")).toBeInTheDocument();
    expect(screen.getByText("חסר סכום.")).toBeInTheDocument();
    expect(screen.getByText("חסרה תקופה.")).toBeInTheDocument();
    expect(screen.getByText("המסים והביטוח גבוהים מהתשלום.")).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("סכום מקורי").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("תקופה בחודשים").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("מסים וביטוח לחודש").closest(".ui-field")).toHaveClass("ui-field-error");

    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "-12" } });
    expect(screen.getByLabelText("סכום מקורי")).toHaveValue("-12");
    expect(screen.getByText("הסכום שלילי.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "-1" } });
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("-1");
    expect(screen.getByText("הריבית שלילית.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "90071992547410" } });
    expect(screen.getByText("הסכום גדול מדי.")).toBeInTheDocument();
  });

  it("shows a field error on blur, and keeps the message line while typing", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const lender = screen.getByLabelText("מלווה");
    const slot = lender.closest(".ui-field")?.querySelector(".ui-field-message-slot");
    expect(slot).not.toBeNull();
    expect(slot).toHaveTextContent("");
    expect(screen.queryByText("חסר מלווה.")).not.toBeInTheDocument();
    fireEvent.blur(lender);
    expect(slot).toHaveTextContent("חסר מלווה.");

    const principal = screen.getByLabelText("סכום מקורי");
    fireEvent.change(principal, { target: { value: "0" } });
    expect(screen.queryByText("חסר סכום.")).not.toBeInTheDocument();
    fireEvent.change(principal, { target: { value: "0.5" } });
    expect(principal).toHaveValue("0.5");
    expect(screen.queryByText("חסר סכום.")).not.toBeInTheDocument();

    const term = screen.getByLabelText("תקופה בחודשים");
    fireEvent.change(term, { target: { value: "" } });
    expect(screen.queryByText("חסרה תקופה.")).not.toBeInTheDocument();
    fireEvent.blur(term);
    expect(screen.getByText("חסרה תקופה.")).toBeInTheDocument();
  });

  it("keeps the computed payment under עוד and shows interest", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    expect(screen.queryByLabelText("תשלום חודשי")).not.toBeInTheDocument();
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    expect(screen.getByText("₪115,838.45")).toBeInTheDocument();
    expect(screen.getByText("₪600")).toBeInTheDocument();
    expect(screen.getByText(/תשלום אחרון מותאם/)).toBeInTheDocument();
    expect(screen.queryByText(/גבוה יותר/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const payment = screen.getByLabelText("תשלום חודשי");
    expect(payment).toHaveValue("599.55");
    fireEvent.change(payment, { target: { value: "" } });
    expect(payment).toHaveValue("");
    fireEvent.blur(payment);
    expect(payment).toHaveValue("599.55");
  });

  it("adds escrow to the stored payment and keeps an edited payment", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={{ ...mortgage, escrow: "100" }} advancedOpen />);
    expect(screen.getByText("₪699.55")).toBeInTheDocument();
    expect(screen.getByText("₪115,838.45")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("תשלום חודשי"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "120000" } });
    expect(screen.getByLabelText("תשלום חודשי")).toHaveValue("800");
  });

  it("warns when the last payment is a balloon", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="USD"
        advancedOpen
        initial={{
          name: "הלוואת דוגמה",
          principal: "10000000",
          rate: "6",
          term: "12",
          startDate: "2026-11-01",
          escrow: "0",
          payment: "50000",
          currency: "USD",
        }}
      />,
    );
    expect(screen.getByText("$50,000")).toBeInTheDocument();
    expect(screen.getByText("$10,050,000")).toBeInTheDocument();
    expect(screen.getByText(/התשלום האחרון גבוה יותר/)).toBeInTheDocument();
  });

  it("says the last payment is double, once, when a 600 month term ends at twice the principal and interest", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        advancedOpen
        initial={{
          name: "הלוואת דוגמה",
          principal: "3606",
          rate: "0",
          term: "600",
          startDate: "2026-11-01",
          escrow: "0",
          payment: "6",
          currency: "ILS",
        }}
      />,
    );
    expect(screen.getByText("₪6")).toBeInTheDocument();
    expect(screen.getAllByText("₪12")).toHaveLength(1);
    expect(screen.getByText(/התשלום האחרון כפול/)).toBeInTheDocument();
    expect(screen.queryByText(/תשלום אחרון מותאם/)).not.toBeInTheDocument();
    expect(screen.queryByText(/גבוה פי/)).not.toBeInTheDocument();
    expect(screen.queryByText(/גבוה יותר/)).not.toBeInTheDocument();
  });

  it("says how many times higher the final payment is when it is above twice", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        initial={{
          name: "הלוואת דוגמה",
          principal: "34910.09",
          rate: "29.8",
          term: "480",
          startDate: "2026-11-01",
          escrow: "0",
        }}
      />,
    );
    expect(screen.getByText("₪866.94")).toBeInTheDocument();
    expect(screen.getAllByText("₪2,541.65")).toHaveLength(1);
    expect(screen.getByText("2.9")).toBeInTheDocument();
    expect(screen.queryByText("2.90")).not.toBeInTheDocument();
    expect(screen.getByText(/התשלום האחרון גבוה פי/)).toBeInTheDocument();
    expect(screen.queryByText(/תשלום אחרון מותאם/)).not.toBeInTheDocument();
    expect(screen.queryByText(/כפול/)).not.toBeInTheDocument();
    expect(screen.queryByText(/גבוה יותר/)).not.toBeInTheDocument();
  });

  it("drops a trailing zero when the final payment is a whole number of times higher", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        advancedOpen
        initial={{
          name: "הלוואת דוגמה",
          principal: "0.06",
          rate: "0",
          term: "4",
          startDate: "2026-11-01",
          escrow: "0",
          payment: "0.01",
        }}
      />,
    );
    expect(screen.getByText("₪0.01")).toBeInTheDocument();
    expect(screen.getByText("₪0.03")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("3.0")).not.toBeInTheDocument();
    expect(screen.getByText(/התשלום האחרון גבוה פי/)).toBeInTheDocument();
    expect(screen.queryByText(/כפול/)).not.toBeInTheDocument();
  });

  it("keeps the adjusted line when the final payment is just under twice", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        advancedOpen
        initial={{
          name: "הלוואת דוגמה",
          principal: "3605.99",
          rate: "0",
          term: "600",
          startDate: "2026-11-01",
          escrow: "0",
          payment: "6",
        }}
      />,
    );
    expect(screen.getByText("₪6")).toBeInTheDocument();
    expect(screen.getByText("₪11.99")).toBeInTheDocument();
    expect(screen.getByText(/תשלום אחרון מותאם/)).toBeInTheDocument();
    expect(screen.queryByText(/כפול/)).not.toBeInTheDocument();
    expect(screen.queryByText(/גבוה פי/)).not.toBeInTheDocument();
  });

  it("does not warn when escrow makes the payment large and the principal stays level", () => {
    renderForm(
      <LoanSetupForm
        companyCurrency="ILS"
        initial={{
          name: "הלוואת דוגמה",
          principal: "3",
          rate: "0",
          term: "3",
          startDate: "2026-11-01",
          escrow: "2",
          payment: "3",
        }}
      />,
    );
    expect(screen.getByText("₪3")).toBeInTheDocument();
    expect(screen.queryByText(/כפול/)).not.toBeInTheDocument();
    expect(screen.queryByText(/תשלום אחרון מותאם/)).not.toBeInTheDocument();
  });
});

describe("LoanSettingsSection", () => {
  it("hides a new loan from a viewer and keeps the balances readable (FLOW-501, U10)", async () => {
    db.loans = [{ id: "l1", name: "משכנתא אלון", currency: "ILS", project_id: null }];
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    );
    expect(await screen.findByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /משכנתא אלון/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הלוואה" })).not.toBeInTheDocument();
  });

  it("shows the empty state with one primary action, and none for a viewer", async () => {
    const owner = renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    expect(await screen.findByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getByText("הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הלוואה חדשה" })).toHaveLength(1);
    owner.unmount();
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    );
    expect(await screen.findByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("returns focus to the empty state's button when the new-loan sheet closes", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    await screen.findByText("אין הלוואות עדיין");
    const add = screen.getByRole("button", { name: "הלוואה חדשה" });
    fireEvent.click(add);
    fireEvent.click(within(screen.getByRole("dialog", { name: "הלוואה" })).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(add).toHaveFocus(); }, { timeout: 2500 });
  });

  it("opens the sheet on the company currency", () => {
    renderSection(<LoanSettingsSection companyId={null} companyCurrency="USD" />);
    openLoan();
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "$" })).toBeChecked();
  });

  it("shows a retry when the balances read fails", async () => {
    db.balanceError = { message: "offline" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    expect(await screen.findByText("לא הצלחנו לטעון את ההלוואות")).toBeInTheDocument();
    // An error is not an empty state with a live primary action (CHECKLIST).
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "ניסיון חוזר" });
    db.balanceError = null;
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument(); });
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
  });

  it("inserts the allowed columns, in minor units, with the typed rate", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("11.2042");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    const payment = contractualPaymentMinor({
      principalMinor: 10_000_000n,
      annualRatePpm: 112_042,
      termMonths: 360,
    });
    expect(db.inserts[0]).toEqual({
      company_id: "co-1",
      name: "הלוואת דוגמה",
      principal_minor: 10_000_000,
      annual_rate_ppm: 112_042,
      term_months: 360,
      start_date: firstOfNextMonth(),
      payment_minor: Number(payment),
      escrow_minor: 0,
      currency: "ILS",
      project_id: null,
    });
  });

  it("posts once when save is submitted twice", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    const save = screen.getByRole("button", { name: "שמירה" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    release();
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה נשמרה"); });
  });

  it("keeps the sheet open and names a permission failure", async () => {
    db.insertError = { message: "denied", code: "42501" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("אין הרשאה לשמור הלוואה.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveFocus();
  });

  it("keeps the sheet open on a generic failure and returns focus to save", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.getByLabelText("סכום מקורי")).toBeDisabled(); });
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("radio", { name: "₪" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "תאריך תשלום ראשון" })).toBeDisabled();
    expect(screen.getByLabelText("מלווה")).toBeDisabled();
    db.insertError = { message: "down" };
    release();
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("לא הצלחנו לשמור את ההלוואה.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toHaveFocus();
    expect(screen.getByLabelText("סכום מקורי")).toBeEnabled();
  });

  it("toasts and closes after a save", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה נשמרה"); });
    await expectReopenedBlank(1);
  });

  it("discards the draft when the sheet is closed", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.click(within(screen.getByRole("dialog", { name: "הלוואה" })).getByRole("button", { name: "סגירה" }));
    await expectReopenedBlank(0);
  });

  it("discards the draft on Escape", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" />);
    openLoan();
    fillSavable();
    fireEvent.keyDown(document, { key: "Escape" });
    await expectReopenedBlank(0);
  });

  it("discards the draft on Back", async () => {
    const router = createMemoryRouter(
      [{ path: "/settings", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" /> }],
      { initialEntries: ["/settings"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    openLoan();
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "loan-new" });
    });
    fillSavable();
    await act(async () => {
      await router.navigate(-1);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expectReopenedBlank(0);
  });

  it("does not insert when preview mode blocks the save", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" blocked={() => true} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 40); });
    });
    expect(db.inserts).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.queryByText("ההלוואה נשמרה")).not.toBeInTheDocument();
  });

  it("keeps typed input when the form remounts", async () => {
    let release: () => void = () => undefined;
    db.currencyHold = new Promise((resolve) => { release = resolve; });
    db.baseCurrency = "USD";
    const view = renderSection(<LoanSettingsSection companyId={null} companyCurrency="ILS" />);
    openLoan();
    fireEvent.change(screen.getByLabelText("מלווה"), { target: { value: "בנק דוגמה" } });
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "1500" } });
    view.rerender(sectionTree(view.client, <LoanSettingsSection companyId="co-1" />));
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(screen.queryByLabelText("מלווה")).not.toBeInTheDocument();
    release();
    expect(await screen.findByLabelText("מלווה")).toHaveValue("בנק דוגמה");
    expect(screen.getByLabelText("סכום מקורי")).toHaveValue("1,500");
  });
});

describe("FLOW-119 loan project", () => {
  const projects = {
    rows: [
      { id: "p-a", name: "פרויקט א", status: "active" as const },
      { id: "p-b", name: "פרויקט ב", status: "active" as const },
      { id: "p-old", name: "פרויקט ישן", status: "finished" as const },
    ],
  };

  it("files a new loan under the picked project and back returns to the form", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    const field = screen.getByRole("button", { name: "פרויקט ללא פרויקט" });
    fireEvent.click(field);
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "פרויקט ישן" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
    expect(screen.getByRole("button", { name: "פרויקט פרויקט א" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    expect(db.inserts[0]?.project_id).toBe("p-a");
  });

  it("keeps the form's height while the picker is shown", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(480);
    onTestFinished(() => { spy.mockRestore(); });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    const group = await screen.findByRole("radiogroup", { name: "פרויקט" });
    expect(group.closest<HTMLElement>("[style]")?.style.minHeight).toBe("480px");
  });

  it("shows project codes and finds a project by its code", () => {
    const many = {
      rows: Array.from({ length: 10 }, (_, index) => ({
        id: `p-${String(index)}`,
        name: `פרויקט ${String(index + 1)}`,
        status: "active" as const,
        code: `P-${String(index + 1)}`,
      })),
    };
    render(<LoanProjectPicker source={many} selectedId={null} onSelect={() => undefined} />);
    const search = screen.getByRole("searchbox", { name: "חיפוש פרויקט" });
    expect(search).toHaveAttribute("placeholder", "חיפוש פרויקט או קוד");
    expect(screen.getByText("P-3")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "p-10" } });
    expect(screen.getAllByRole("radio").map((node) => node.getAttribute("aria-label") ?? node.textContent)).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /פרויקט 10/ })).toBeInTheDocument();
  });

  it("keeps the plain placeholder when no project has a code", () => {
    const many = { rows: Array.from({ length: 10 }, (_, index) => ({ id: `p-${String(index)}`, name: `פרויקט ${String(index + 1)}` })) };
    render(<LoanProjectPicker source={many} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveAttribute("placeholder", "חיפוש פרויקט");
  });

  it("keeps ללא פרויקט when the projects fail to load", () => {
    renderSection(
      <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={{ rows: [], error: true }} />,
    );
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: פרויקטים" })).toBeInTheDocument();
  });

  it("moves focus to the picker title, and back to the field on חזרה", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    const field = screen.getByRole("button", { name: "פרויקט ללא פרויקט" });
    field.focus();
    fireEvent.click(field);
    await waitFor(() => { expect(screen.getByRole("heading", { name: "פרויקט" })).toHaveFocus(); });
    expect(field).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => { expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toHaveFocus(); });
  });

  it("moves an existing loan to another project and clears it", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    const row = await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט א$/ });
    fireEvent.click(row);
    expect(screen.getByRole("radio", { name: "פרויקט א" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט ב" }));
    await waitFor(() => { expect(db.updates).toHaveLength(1); });
    expect(db.updates[0]).toEqual({ row: { project_id: "p-b" }, id: "l-1" });
    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("ההלוואה שויכה לפרויקט"); });
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקט" })).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: /^הלוואת דוגמה, .*פרויקט:/ }));
    fireEvent.click(screen.getByRole("radio", { name: "ללא פרויקט" }));
    await waitFor(() => { expect(db.updates).toHaveLength(2); });
    expect(db.updates[1]).toEqual({ row: { project_id: null }, id: "l-1" });
  });

  it("treats no row back as a refusal and keeps the sheet", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: null }];
    db.updateRows = 0;
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: ללא פרויקט$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("אין הרשאה לעדכן הלוואה.");
    });
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toHaveAttribute("aria-checked", "true"); });
  });

  it("waits for the save: other rows are disabled and Escape does not close", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    let release: () => void = () => undefined;
    db.updateHold = new Promise((resolve) => { release = resolve; });
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט א$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט ב" }));
    await waitFor(() => { expect(screen.getByRole("radio", { name: "פרויקט א" })).toHaveAttribute("aria-disabled", "true"); });
    expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקט" })).not.toBeInTheDocument(); });
  });

  it("keeps the sheet on Back while a tap is saving", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    let release: () => void = () => undefined;
    db.updateHold = new Promise((resolve) => { release = resolve; });
    const router = createMemoryRouter(
      [{ path: "/settings", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} /> }],
      { initialEntries: ["/settings"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט א$/ }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "loan-project" });
    });
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט ב" }));
    await act(async () => {
      await router.navigate(-1);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    });
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("ההלוואה שויכה לפרויקט"); });
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקט" })).not.toBeInTheDocument(); });
  });

  it("goes back to the form on Back in the new-loan picker and keeps the draft", async () => {
    const router = createMemoryRouter(
      [{ path: "/settings", element: <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} /> }],
      { initialEntries: ["/settings"] },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הלוואה חדשה" }));
    await waitFor(() => {
      expect(router.state.location.state).toMatchObject({ flowLayer: "loan-new" });
    });
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
  });

  it("shows a viewer static loan rows", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />
      </ViewerPreview>,
    );
    expect(await screen.findByText("פרויקט א")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הלוואת דוגמה/ })).not.toBeInTheDocument();
  });

  it("keeps a finished current project, marked הסתיים, and closes without a write on the checked row", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-old" }];
    db.projects = [{ id: "p-old", name: "פרויקט ישן" }];
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט ישן$/ }));
    const current = screen.getByRole("radio", { name: /^פרויקט ישן/ });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(within(current).getByText("הסתיים")).toBeInTheDocument();
    fireEvent.click(current);
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(db.updates).toHaveLength(0);
  });

  it("rolls back and keeps the sheet when the project is gone (23503)", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: "p-a" }];
    db.projects = [{ id: "p-a", name: "פרויקט א" }];
    db.updateError = { message: "fk", code: "23503" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: פרויקט א$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט ב" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("הפרויקט לא נמצא.");
    });
    expect(screen.getByRole("heading", { name: "פרויקט" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole("radio", { name: "פרויקט א" })).toHaveAttribute("aria-checked", "true"); });
  });

  it("refetches loans and the project screen after a change and after a new loan", async () => {
    db.loans = [{ id: "l-1", name: "הלוואת דוגמה", currency: "ILS", project_id: null }];
    const view = renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    const invalidate = vi.spyOn(view.client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת דוגמה, .*פרויקט: ללא פרויקט$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["loans"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] });
    invalidate.mockClear();
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(db.inserts).toHaveLength(1); });
    await waitFor(() => { expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["loans"] });
  });

  it("resets the project to ללא פרויקט when the project is gone on save", async () => {
    db.insertError = { message: "fk", code: "23503" };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("הפרויקט לא נמצא.");
    });
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toBeInTheDocument();
  });

  it("reopens on the form with ללא פרויקט after closing from the picker", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.click(screen.getByRole("radio", { name: "פרויקט א" }));
    fireEvent.click(screen.getByRole("button", { name: "פרויקט פרויקט א" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "פרויקט" })).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    openLoan();
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט ללא פרויקט" })).toBeInTheDocument();
  });

  it("returns to the form on Escape in the picker and keeps the draft", async () => {
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={projects} />);
    openLoan();
    fillSavable();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument(); });
    expect(screen.getByLabelText("מלווה")).toHaveValue("הלוואת דוגמה");
  });

  it("searches above eight projects and keeps ללא פרויקט", () => {
    const many = { rows: Array.from({ length: 9 }, (_, index) => ({ id: `m${String(index)}`, name: `פרויקט ${String(index + 1)}`, status: "active" as const })) };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={many} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    const search = screen.getByRole("searchbox", { name: "חיפוש פרויקט" });
    fireEvent.change(search, { target: { value: "9" } });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "פרויקט 9" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "אין כזה" } });
    expect(screen.getByText("לא נמצא פרויקט בשם הזה")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toBeInTheDocument();
  });

  it("has no search with eight projects", () => {
    const eight = { rows: Array.from({ length: 8 }, (_, index) => ({ id: `m${String(index)}`, name: `פרויקט ${String(index + 1)}`, status: "active" as const })) };
    renderSection(<LoanSettingsSection companyId="co-1" companyCurrency="ILS" projects={eight} />);
    openLoan();
    fireEvent.click(screen.getByRole("button", { name: "פרויקט ללא פרויקט" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
