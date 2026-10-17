import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
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
  it("lists the open loans with cents, a rate and a kind in each row's meta", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans }} />);
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.getByText("2 פעילות")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא אלון, \$200,000,/ })).toHaveTextContent("וילה אלון · 6.25% · פריסה רגילה");
    expect(screen.getByRole("button", { name: /^הלוואת ציוד, / })).toHaveTextContent(/ממתין לבדיקה · ללא פרויקט · 10\.5% · ריבית בלבד/);
    expect(screen.getByRole("button", { name: "+ הלוואה חדשה" })).toBeInTheDocument();
  });

  it("lets a viewer read the balances and open a loan's page, with no new loan (FLOW-106 B)", () => {
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: twoLoans }} />
      </ViewerPreview>,
    );
    expect(screen.getByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.getByText("הלוואת ציוד")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא אלון, / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הלוואה חדשה/ })).not.toBeInTheDocument();
  });

  it("collapses the closed group, opens it on הצג and shuts it on הסתר", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed }} />);
    const toggle = screen.getByRole("button", { name: /^נסגרו · 1/ });
    expect(toggle).toHaveTextContent("הצג");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^הלוואת גשר, / })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("הסתר");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const closed = screen.getByRole("button", { name: /^הלוואת גשר, / });
    expect(closed).toHaveTextContent("וילה אלון · בלון · נפרעה 11/2025");
    expect(closed.querySelector(".ui-loans-amount")).toHaveTextContent("$0");
    expect(closed).toHaveAccessibleName(/^הלוואת גשר, \$0, /);
  });

  it("opens the closed group from the URL (the dev fixture's ?closed=1)", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed }} closedOpen />);
    expect(screen.getByRole("button", { name: /^נסגרו · 1/ })).toHaveAttribute("aria-expanded", "true");
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

  it("shows the empty state, and the viewer's has no button", () => {
    const owner = renderAt(<LoansScreen sample={{ ...business, loans: [] }} />);
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הלוואה חדשה" })).toHaveLength(1);
    owner.unmount();
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: [] }} />
      </ViewerPreview>,
    );
    expect(screen.getByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הלוואה חדשה/ })).not.toBeInTheDocument();
  });

  it("shows only the closed group, titled הלוואות שנסגרו, under the empty state", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: withClosed.slice(2) }} />);
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^הלוואות שנסגרו/ })).toBeInTheDocument();
  });

  it("shows the error layout with ניסיון חוזר and no live primary action", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: "error" }} />);
    expect(screen.getByText("לא הצלחנו לטעון את ההלוואות")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ הלוואה חדשה" })).toBeInTheDocument();
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
