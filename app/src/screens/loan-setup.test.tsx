import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contractualPaymentMinor } from "@flow/shared";
import { dayLabel, formatDisplay, israelToday, shiftDays } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { companyLoanCurrency, firstOfNextMonth, readCompanyLoanCurrency } from "./loan-form";
import { LoanSettingsSection, LoanSetupForm } from "./loan-setup";

const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string; code?: string } | null,
  hold: null as Promise<void> | null,
  currencies: [] as string[],
  currencyError: null as { message: string } | null,
  currencyHold: null as Promise<void> | null,
  offline: false,
  selects: 0,
  balanceError: null as { message: string } | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => {
    if (db.offline) return null;
    return {
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
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        if (table === "loan_balances") {
          return {
            select: () => Promise.resolve({
              data: db.balanceError ? null : [],
              error: db.balanceError,
            }),
          };
        }
        if (table === "transactions") {
          return {
            select: () => ({
              is: () => {
                db.selects += 1;
                const finish = () => ({
                  data: db.currencyError ? null : db.currencies.map((currency) => ({ currency })),
                  error: db.currencyError,
                });
                if (db.currencyHold) return db.currencyHold.then(() => finish());
                return Promise.resolve(finish());
              },
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
  db.currencies = [];
  db.currencyError = null;
  db.currencyHold = null;
  db.offline = false;
  db.selects = 0;
  db.balanceError = null;
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
  it("uses dollars only when every open line is USD", () => {
    expect(companyLoanCurrency([])).toBe("ILS");
    expect(companyLoanCurrency(["USD"])).toBe("USD");
    expect(companyLoanCurrency(["USD", "USD"])).toBe("USD");
    expect(companyLoanCurrency(["ILS"])).toBe("ILS");
    expect(companyLoanCurrency(["USD", "ILS"])).toBe("ILS");
    expect(companyLoanCurrency(["EUR"])).toBe("ILS");
    expect(companyLoanCurrency(["USD", "EUR"])).toBe("ILS");
  });

  it("starts the loan on the first day of next month in Jerusalem", () => {
    expect(firstOfNextMonth(new Date("2026-10-04T12:00:00Z"))).toBe("2026-11-01");
    expect(firstOfNextMonth(new Date("2026-12-15T12:00:00Z"))).toBe("2027-01-01");
  });

  it("reads that rule from open lines and stays on shekels when the read fails", async () => {
    db.offline = true;
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    db.offline = false;
    db.currencies = [];
    expect(await readCompanyLoanCurrency()).toBe("ILS");
    db.currencies = ["USD", "USD"];
    expect(await readCompanyLoanCurrency()).toBe("USD");
    db.currencies = ["USD", "EUR"];
    expect(await readCompanyLoanCurrency()).toBe("ILS");
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
  it("hides a new loan from a viewer", () => {
    renderSection(
      <ViewerPreview>
        <LoanSettingsSection companyId="co-1" companyCurrency="ILS" />
      </ViewerPreview>,
    );
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הלוואה" })).not.toBeInTheDocument();
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
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: יתרות הלוואות" });
    db.balanceError = null;
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.queryByRole("button", { name: "ניסיון חוזר: יתרות הלוואות" })).not.toBeInTheDocument(); });
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
    db.currencies = ["USD"];
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
