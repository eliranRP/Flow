import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { companyLoanCurrency, firstOfNextMonth } from "./loan-form";
import { LoanSettingsSection, LoanSetupForm } from "./loan-setup";

const mortgage = {
  name: "הלוואת דוגמה",
  principal: "100000",
  rate: "6",
  term: "360",
  startDate: "2026-11-01",
  escrow: "0",
};

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
});

describe("LoanSetupForm", () => {
  it("defaults a dollar company to $ and USD", () => {
    render(<LoanSetupForm companyCurrency="USD" />);
    expect(screen.getByLabelText("מטבע")).toHaveValue("USD");
    expect(screen.getAllByText("$").length).toBeGreaterThan(0);
    expect(screen.queryByText("₪")).not.toBeInTheDocument();
    expect(screen.getByLabelText("תקופה בחודשים")).toHaveValue("360");
    expect(screen.getByLabelText("מסים וביטוח לחודש")).toHaveValue("0");
  });

  it("defaults a shekel company to ₪", () => {
    render(<LoanSetupForm companyCurrency="ILS" />);
    expect(screen.getByLabelText("מטבע")).toHaveValue("ILS");
    expect(screen.getAllByText("₪").length).toBeGreaterThan(0);
    expect(screen.queryByText("$")).not.toBeInTheDocument();
  });

  it("keeps the computed payment under עוד and shows interest", () => {
    render(<LoanSetupForm companyCurrency="ILS" initial={mortgage} />);
    expect(screen.queryByLabelText("תשלום חודשי")).not.toBeInTheDocument();
    expect(screen.getByText("₪599.55")).toBeInTheDocument();
    expect(screen.getByText("₪115,838.45")).toBeInTheDocument();
    expect(screen.getByText("₪600.00")).toBeInTheDocument();
    expect(screen.getByText(/תשלום אחרון מותאם/)).toBeInTheDocument();
    expect(screen.queryByText(/גבוה יותר/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    expect(screen.getByLabelText("תשלום חודשי")).toHaveValue("599.55");
  });

  it("adds escrow to the stored payment and keeps an edited payment", () => {
    render(<LoanSetupForm companyCurrency="ILS" initial={{ ...mortgage, escrow: "100" }} advancedOpen />);
    expect(screen.getByText("₪699.55")).toBeInTheDocument();
    expect(screen.getByText("₪115,838.45")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("תשלום חודשי"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("סכום מקורי"), { target: { value: "120000" } });
    expect(screen.getByLabelText("תשלום חודשי")).toHaveValue("800");
  });

  it("warns when the last payment is a balloon", () => {
    render(
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
    expect(screen.getByText("$50,000.00")).toBeInTheDocument();
    expect(screen.getByText("$10,050,000.00")).toBeInTheDocument();
    expect(screen.getByText(/התשלום האחרון גבוה יותר/)).toBeInTheDocument();
  });

  it("warns when a 600 month term ends at twice the payment", () => {
    render(
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
    expect(screen.getByText("₪6.00")).toBeInTheDocument();
    expect(screen.getByText("₪12.00")).toBeInTheDocument();
    expect(screen.getByText(/התשלום האחרון כפול/)).toBeInTheDocument();
    expect(screen.queryByText(/גבוה יותר/)).not.toBeInTheDocument();
    expect(screen.queryByText(/תשלום אחרון מותאם/)).not.toBeInTheDocument();
  });
});

describe("LoanSettingsSection", () => {
  it("opens the sheet on the company currency", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <LoanSettingsSection companyId={null} companyCurrency="USD" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הלוואה חדשה" }));
    expect(screen.getByRole("heading", { name: "הלוואה" })).toBeInTheDocument();
    expect(screen.getByLabelText("מטבע")).toHaveValue("USD");
  });
});
