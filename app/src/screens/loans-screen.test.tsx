import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { LOAN_SUMMARY_SAMPLE } from "../dev/loan-summary-sample";
import { LoansScreen } from "./loans-screen";

// FLOW-139b. The הלוואות tab: a top-level list at /loans, with the open loans, then the closed group.

const business = {
  name: "אלפא בנייה",
  connected: true,
  companyId: 1000,
  lastError: null,
  email: "owner@example.com",
};

const twoLoans = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון", ratePpm: 62_500, kind: "amortizing" as const },
  { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: null, projectName: null, ratePpm: 105_000, kind: "interest_only" as const },
];

const withClosed = [
  ...twoLoans,
  { id: "l3", name: "הלוואת גשר", currency: "USD", balanceMinor: 0n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון", kind: "balloon" as const, status: "paid_off" as const, closedOn: "2025-11-30" },
];

function providers(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BooksProvider>{ui}</BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderAt(ui: ReactNode, path = "/loans") {
  return render(providers(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>));
}

describe("Loans tab", () => {
  it("groups the open loans by kind, each row with its balance and its line", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans }} />);
    expect(screen.getByRole("heading", { level: 1, name: "הלוואות" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פריסה רגילה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ריבית בלבד" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא אלון, \$200,000, / })).toHaveAccessibleName(/וילה אלון$/);
    expect(screen.getByRole("button", { name: /^הלוואת ציוד, / })).toHaveAccessibleName(/ממתין לבדיקה · בלי תשלום קבוע · בלי פרויקט$/);
    expect(screen.getByRole("button", { name: "הלוואה חדשה" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "פעילות · 2" })).toHaveAttribute("aria-checked", "true");
  });

  it("lets a viewer read the balances and open a loan's page, with no new loan (FLOW-106 B)", () => {
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: twoLoans }} />
      </ViewerPreview>,
    );
    expect(screen.getByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^הלוואת ציוד, / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הלוואה חדשה/ })).not.toBeInTheDocument();
  });

  it("shows the closed loans under נסגרו, each with how and when it ended", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed }} />);
    expect(screen.queryByRole("button", { name: /^הלוואת גשר, / })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("radio", { name: "נסגרו · 1" })[0] as HTMLElement);
    const closed = screen.getByRole("button", { name: /^הלוואת גשר, / });
    expect(closed).toHaveAccessibleName("הלוואת גשר, $0, נפרעה 11/2025 · וילה אלון");
    expect(screen.getByRole("heading", { name: "בלון" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^משכנתא אלון, / })).not.toBeInTheDocument();
  });

  it("opens on נסגרו from the URL (the dev fixture's ?closed=1)", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed }} closedOpen />);
    expect(screen.getAllByRole("radio", { name: "נסגרו · 1" })[0]).toHaveAttribute("aria-checked", "true");
  });

  it("opens a loan's page at /loans/:id from its row", async () => {
    const router = createMemoryRouter(
      [
        { path: "/loans", element: <LoansScreen sample={{ ...business, loans: twoLoans }} /> },
        { path: "/loans/:loanId", element: <p>עמוד ההלוואה</p> },
      ],
      { initialEntries: ["/loans"] },
    );
    render(providers(<RouterProvider router={router} />));
    fireEvent.click(await screen.findByRole("button", { name: /^הלוואת ציוד, / }));
    expect(router.state.location.pathname).toBe("/loans/l2");
    expect(await screen.findByText("עמוד ההלוואה")).toBeInTheDocument();
  });

  it("opens the summary page from the band (/loans/summary), with what is left to pay", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans, loanCurrency: "USD", summary: LOAN_SUMMARY_SAMPLE }} />);
    const band = screen.getAllByRole("link", { name: /נשאר לשלם/ })[0];
    expect(band).toHaveAttribute("href", "/loans/summary");
    expect(screen.getByText("תשלומים בחודש")).toBeInTheDocument();
    expect(screen.getByText(/^התשלום הבא · Ember · 01\/11$/)).toBeInTheDocument();
  });

  it("puts a loan that waits for a check in דורש טיפול", () => {
    window.localStorage.removeItem("flow.attention.loans");
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans }} />);
    expect(screen.getByRole("link", { name: /תשלום אחד ממתין לבדיקה · הלוואת ציוד/ })).toHaveAttribute("href", "/loans/l2");
  });

  it("shows the empty state, and the viewer's has no button", () => {
    const owner = renderAt(<LoansScreen sample={{ ...business, loans: [] }} />);
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספת הלוואה" })).toBeInTheDocument();
    expect(screen.queryByText("0 פעילות")).not.toBeInTheDocument();
    owner.unmount();
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: [] }} />
      </ViewerPreview>,
    );
    expect(screen.getByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הלוואה חדשה/ })).not.toBeInTheDocument();
  });

  it("keeps the נסגרו segment under the empty state when only closed loans are left", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed.slice(2) }} />);
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: "נסגרו · 1" })[0]).toBeInTheDocument();
  });

  it("shows the failure with נסו שוב and צריך עזרה? (FLOW-962)", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: "error" }} />);
    expect(screen.getByRole("heading", { name: "ההלוואות לא נטענו" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("says which moment the list is from when offline (FLOW-962)", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans, offlineSince: Date.UTC(2026, 9, 9, 6, 41) }} />);
    expect(screen.getAllByRole("status", { hidden: true }).find((node) => node.classList.contains("ui-page-offline"))).toHaveTextContent("אין חיבור · מוצג המצב מ־09:41");
  });

  it("goes back to Settings with no company", async () => {
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <h1>הגדרות</h1> },
        { path: "/loans", element: <LoansScreen sample={{ ...business, noCompany: true }} /> },
      ],
      { initialEntries: ["/loans"] },
    );
    render(providers(<RouterProvider router={router} />));
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings");
  });
});
