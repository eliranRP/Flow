import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayLabel, formatDisplay, israelToday, shiftDays } from "../ui/date-math";
import { readCompanyCurrency } from "../company-currency";
import { companyLoanCurrency, firstOfNextMonth, readCompanyLoanCurrency } from "./loan-form";
import { LoanSetupForm } from "./loan-setup";

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
            select: () => ({
              eq: () => Promise.resolve({
                data: db.balanceError ? null : db.loans.map((loan) => ({ loan_id: loan.id, balance_minor: 500000, flagged_parts: 0, currency: loan.currency })),
                error: db.balanceError,
              }),
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
    db.baseCurrency = "EUR";
    expect(await readCompanyCurrency()).toBe("EUR");
    db.baseCurrency = "usd";
    expect(await readCompanyCurrency()).toBe("ILS");
    db.baseCurrency = "USD";
    db.currencyError = { message: "down" };
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    expect(db.selects).toBe(6);
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
    expect(screen.queryByText("כתבו בין 1 ל־600 חודשים.")).not.toBeInTheDocument();
    fireEvent.change(term, { target: { value: "1000" } });
    expect(term).toHaveValue("1000");
    expect(screen.queryByText("כתבו בין 1 ל־600 חודשים.")).not.toBeInTheDocument();
    fireEvent.blur(term);
    expect(screen.getByText("כתבו בין 1 ל־600 חודשים.")).toBeInTheDocument();
  });

  it("keeps the last preview while a field is incomplete", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "6." } });
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("6.");
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    // FLOW-115: שמירה stays tappable; a tap shows what to type.
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();
    expect(screen.queryByText("כתבו ריבית עד 100%.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "" } });
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "" } });
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    expect(screen.queryByText("הסכום צריך להיות גדול מ־0.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByText("כתבו את הסכום המקורי.")).toBeInTheDocument();
    expect(screen.getByText("כתבו את הריבית השנתית.")).toBeInTheDocument();
  });

  it("dims the kept preview while a field is incomplete, and says 0 is too small (FLOW-115)", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    const preview = screen.getByText("₪599.55").closest("[aria-live]");
    expect(preview).not.toHaveClass("ui-loan-preview-stale");
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "" } });
    expect(screen.getByText("₪599.55").closest("[aria-live]")).toHaveClass("ui-loan-preview-stale");
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "0" } });
    fireEvent.blur(screen.getByLabelText("סכום מקורי"));
    expect(screen.getByText("הסכום צריך להיות גדול מ־0.")).toBeInTheDocument();
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
    expect(screen.queryByText("כתבו את שם המלווה.")).not.toBeInTheDocument();
    expect(screen.queryByText("הסכום צריך להיות גדול מ־0.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    const lender = screen.getByLabelText("מלווה");
    expect(document.getElementById(lender.getAttribute("aria-describedby") ?? "")).toHaveTextContent("כתבו את שם המלווה.");
    expect(screen.getByText("כתבו את שם המלווה.")).toBeInTheDocument();
    expect(screen.getByText("הסכום צריך להיות גדול מ־0.")).toBeInTheDocument();
    expect(screen.getByText("כתבו את מספר החודשים.")).toBeInTheDocument();
    expect(screen.getByText("המסים והביטוח צריכים להיות נמוכים מהתשלום.")).toBeInTheDocument();
    expect(screen.getByLabelText("מלווה").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("סכום מקורי").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("תקופה בחודשים").closest(".ui-field")).toHaveClass("ui-field-error");
    expect(screen.getByLabelText("מסים וביטוח לחודש").closest(".ui-field")).toHaveClass("ui-field-error");

    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "-12" } });
    expect(screen.getByLabelText("סכום מקורי")).toHaveValue("-12");
    expect(screen.getByText("כתבו סכום בלי מינוס.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ריבית שנתית"), { target: { value: "-1" } });
    expect(screen.getByLabelText("ריבית שנתית")).toHaveValue("-1");
    expect(screen.getByText("כתבו ריבית בלי מינוס.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "90071992547410" } });
    expect(screen.getByText("כתבו סכום קטן יותר.")).toBeInTheDocument();
  });

  it("shows a field error on blur, and keeps the message line while typing", () => {
    renderForm(<LoanSetupForm companyCurrency="ILS" />);
    const lender = screen.getByLabelText("מלווה");
    const slot = lender.closest(".ui-field")?.querySelector(".ui-field-message-slot");
    expect(slot).not.toBeNull();
    expect(slot).toHaveTextContent("");
    expect(screen.queryByText("כתבו את שם המלווה.")).not.toBeInTheDocument();
    fireEvent.blur(lender);
    expect(slot).toHaveTextContent("כתבו את שם המלווה.");

    const principal = screen.getByLabelText("סכום מקורי");
    fireEvent.change(principal, { target: { value: "0" } });
    expect(screen.queryByText("הסכום צריך להיות גדול מ־0.")).not.toBeInTheDocument();
    fireEvent.change(principal, { target: { value: "0.5" } });
    expect(principal).toHaveValue("0.5");
    expect(screen.queryByText("הסכום צריך להיות גדול מ־0.")).not.toBeInTheDocument();

    const term = screen.getByLabelText("תקופה בחודשים");
    fireEvent.change(term, { target: { value: "" } });
    expect(screen.queryByText("כתבו את מספר החודשים.")).not.toBeInTheDocument();
    fireEvent.blur(term);
    expect(screen.getByText("כתבו את מספר החודשים.")).toBeInTheDocument();
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
