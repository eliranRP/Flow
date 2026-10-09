import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { connectionsHint, ConnectionsScreen, LoansScreen, loansCountHint, SettingsScreen } from "./flow-screens";

// FLOW-501. Settings keeps the account, תצוגה and עוד; חיבורים and הלוואות open pages.

const business = {
  name: "אלפא בנייה",
  connected: true,
  companyId: 1000,
  lastError: null,
  email: "owner@example.com",
  mercuryConnected: true,
  jev: { enabled: false, mode: "shadow" as const, threshold: 0.9, status: "ready" as const },
  assistant: { state: "connected" as const, scope: "read_write" as const, id: "mcp-1" },
};

const twoLoans = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון" },
  { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: null, projectName: null },
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

function renderAt(ui: ReactNode, path = "/settings") {
  return render(providers(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>));
}

function hintOf(link: HTMLElement): string {
  return document.getElementById(link.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
}

describe("connectionsHint", () => {
  it("counts active connectors, names one that needs you, and counts several", () => {
    expect(connectionsHint([
      { name: "SUMIT", state: "active" },
      { name: "Mercury", state: "active" },
      { name: "תיוג חכם", state: "off" },
      { name: "עוזר AI", state: "active" },
    ])).toEqual({ kind: "count", active: 3, total: 4 });
    expect(connectionsHint([
      { name: "SUMIT", state: "active" },
      { name: "Mercury", state: "reconnect" },
    ])).toEqual({ kind: "attention", text: "Mercury: צריך לחבר מחדש" });
    expect(connectionsHint([
      { name: "SUMIT", state: "reconnect" },
      { name: "עוזר AI", state: "reconnect" },
    ])).toEqual({ kind: "attention", text: "2 חיבורים צריכים חיבור מחדש" });
  });

  it("never guesses a count while one status loads or fails", () => {
    expect(connectionsHint([{ name: "SUMIT", state: "loading" }, { name: "Mercury", state: "error" }])).toEqual({ kind: "loading" });
    expect(connectionsHint([{ name: "SUMIT", state: "active" }, { name: "Mercury", state: "error" }])).toEqual({ kind: "error" });
  });

  it("words the loans count", () => {
    render(<p>{loansCountHint(2)}</p>);
    expect(screen.getByText(/הלוואות/)).toHaveTextContent("2 הלוואות");
    expect(loansCountHint(0)).toBe("אין הלוואות עדיין");
    expect(loansCountHint(1)).toBe("הלוואה אחת");
  });
});

describe("Settings rows", () => {
  it("opens the two pages from one quiet group under the account", () => {
    renderAt(<SettingsScreen sample={{ ...business, loans: twoLoans }} />);
    const connections = screen.getByRole("link", { name: "חיבורים" });
    const loans = screen.getByRole("link", { name: "הלוואות" });
    expect(connections).toHaveAttribute("href", "/settings/connections");
    expect(loans).toHaveAttribute("href", "/settings/loans");
    expect(hintOf(connections)).toBe("3 מתוך 4 פעילים");
    expect(hintOf(loans)).toBe("2 הלוואות");
    expect(connections).not.toHaveClass("ui-row-tone-warning");
    expect(screen.queryByRole("heading", { name: "חיבורים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הלוואות" })).not.toBeInTheDocument();
    // The connector rows and the loan list live on their pages now.
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByText("משכנתא אלון")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("names a broken connector in the warning tone", () => {
    renderAt(<SettingsScreen sample={{ ...business, mercuryLastError: "auth" }} />);
    const connections = screen.getByRole("link", { name: "חיבורים" });
    expect(hintOf(connections)).toBe("Mercury: צריך לחבר מחדש");
    expect(connections).toHaveClass("ui-row-tone-warning");
    expect(hintOf(screen.getByRole("link", { name: "הלוואות" }))).toBe("אין הלוואות עדיין");
  });

  it("counts two broken connectors", () => {
    renderAt(<SettingsScreen sample={{ ...business, lastError: "sumit_auth", assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />);
    expect(hintOf(screen.getByRole("link", { name: "חיבורים" }))).toBe("2 חיבורים צריכים חיבור מחדש");
  });

  it("shows a skeleton hint while a status loads and a short failure without a retry", () => {
    const loading = renderAt(<SettingsScreen sample={{ ...business, mercury: "loading", loans: "loading" }} />);
    expect(screen.getByRole("link", { name: "חיבורים" }).querySelector(".ui-row-hint-skel")).not.toBeNull();
    expect(screen.getByRole("link", { name: "הלוואות" }).querySelector(".ui-row-hint-skel")).not.toBeNull();
    loading.unmount();
    renderAt(<SettingsScreen sample={{ ...business, sumit: "error", loans: "error" }} />);
    expect(hintOf(screen.getByRole("link", { name: "חיבורים" }))).toBe("לא הצלחנו לטעון");
    expect(hintOf(screen.getByRole("link", { name: "הלוואות" }))).toBe("לא הצלחנו לטעון");
    expect(screen.queryByRole("button", { name: /ניסיון חוזר/ })).not.toBeInTheDocument();
  });

  it("keeps both rows for a viewer and reads an expired connector as off", () => {
    renderAt(
      <ViewerPreview>
        <SettingsScreen sample={{ ...business, mercuryLastError: "auth", loans: twoLoans }} />
      </ViewerPreview>,
    );
    const connections = screen.getByRole("link", { name: "חיבורים" });
    expect(hintOf(connections)).toBe("2 מתוך 4 פעילים");
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/settings/loans");
  });

  it("hides הלוואות with no company", () => {
    renderAt(<SettingsScreen sample={{ ...business, name: null, noCompany: true }} />);
    expect(hintOf(screen.getByRole("link", { name: "חיבורים" }))).toBe("אין עסק עדיין");
    expect(screen.queryByRole("link", { name: "הלוואות" })).not.toBeInTheDocument();
  });
});

describe("Settings redirects", () => {
  it.each([
    ["sumit", "חיבור SUMIT"],
    ["mercury", "חיבור Mercury"],
    ["assistant", "חיבור עוזר AI"],
  ])("moves /settings?sheet=%s to the Connections page with the sheet open", async (sheet, dialog) => {
    const sample = { ...business, connected: false, companyId: null, mercuryConnected: false, assistant: { state: "empty" as const } };
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <SettingsScreen sample={sample} /> },
        { path: "/settings/connections", element: <ConnectionsScreen sample={sample} /> },
      ],
      { initialEntries: [`/settings?sheet=${sheet}`] },
    );
    render(providers(<RouterProvider router={router} />));
    expect(await screen.findByRole("dialog", { name: dialog })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/connections");
  });

  it("returns focus to the Settings row on Back from a page", async () => {
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <SettingsScreen sample={business} /> },
        { path: "/settings/connections", element: <ConnectionsScreen sample={business} /> },
        { path: "/settings/loans", element: <LoansScreen sample={business} /> },
      ],
      { initialEntries: ["/settings"] },
    );
    render(providers(<RouterProvider router={router} />));
    fireEvent.click(screen.getByRole("link", { name: "חיבורים" }));
    expect(await screen.findByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(screen.getByRole("link", { name: "חיבורים" })).toHaveFocus(); });
    fireEvent.click(screen.getByRole("link", { name: "הלוואות" }));
    expect(await screen.findByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(screen.getByRole("link", { name: "הלוואות" })).toHaveFocus(); });
  });

  it("does not move focus on a fresh visit to Settings", async () => {
    renderAt(<SettingsScreen sample={business} />);
    await new Promise((resolve) => { window.setTimeout(resolve, 20); });
    expect(screen.getByRole("link", { name: "חיבורים" })).not.toHaveFocus();
  });
});

describe("Connections page", () => {
  it("groups the four connectors under ספרים ובנק and עזרים, with Back to Settings", () => {
    renderAt(<ConnectionsScreen sample={business} />, "/settings/connections");
    expect(screen.getByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חזרה להגדרות" })).toBeInTheDocument();
    const books = screen.getByRole("heading", { name: "ספרים ובנק" });
    const helpers = screen.getByRole("heading", { name: "עזרים" });
    const sumit = screen.getByRole("button", { name: "SUMIT" });
    const jev = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    const assistant = screen.getByRole("button", { name: "עוזר AI" });
    const order = [books, sumit, screen.getByRole("button", { name: "Mercury" }), helpers, jev, assistant];
    for (let index = 1; index < order.length; index += 1) {
      const before = order[index - 1];
      const after = order[index];
      if (before == null || after == null) throw new Error("order");
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
  });

  it("shows static rows with no chevrons for a viewer", () => {
    renderAt(
      <ViewerPreview>
        <ConnectionsScreen sample={business} />
      </ViewerPreview>,
      "/settings/connections",
    );
    expect(screen.getByText("SUMIT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mercury" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עוזר AI" })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("stays open with no company and offers the business details", () => {
    renderAt(<ConnectionsScreen sample={{ ...business, name: null, noCompany: true, assistant: { state: "no-company" } }} />, "/settings/connections");
    fireEvent.click(screen.getByRole("button", { name: "SUMIT" }));
    const sheet = screen.getByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(sheet).getByRole("link", { name: "פרטי העסק" })).toHaveAttribute("href", "/onboarding?return=%2Fsettings%2Fconnections%3Fsheet%3Dsumit");
  });
});

describe("Loans page", () => {
  it("lists the balances with cents and a new-loan row for the owner", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans }} />, "/settings/loans");
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא אלון, \$200,000\.00/ })).toBeInTheDocument();
    expect(screen.getByText("ממתין לבדיקה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הלוואה חדשה" })).toBeInTheDocument();
  });

  it("lets a viewer read the balances, with no new loan and no chevrons", () => {
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: twoLoans }} />
      </ViewerPreview>,
      "/settings/loans",
    );
    expect(screen.getByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.getByText("הלוואת ציוד")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /משכנתא אלון/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("shows the empty state, and the viewer's has no button", () => {
    const owner = renderAt(<LoansScreen sample={{ ...business, loans: [] }} />, "/settings/loans");
    expect(screen.getByText("אין הלוואות עדיין")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הלוואה חדשה" })).toHaveLength(1);
    owner.unmount();
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: [] }} />
      </ViewerPreview>,
      "/settings/loans",
    );
    expect(screen.getByText("כשיתווספו הלוואות הן יופיעו כאן.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("shows the error layout with ניסיון חוזר and no live primary action", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: "error" }} />, "/settings/loans");
    expect(screen.getByText("לא הצלחנו לטעון את ההלוואות")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("goes back to Settings with no company", async () => {
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <h1>הגדרות</h1> },
        { path: "/settings/loans", element: <LoansScreen sample={{ ...business, noCompany: true }} /> },
      ],
      { initialEntries: ["/settings/loans"] },
    );
    render(providers(<RouterProvider router={router} />));
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings");
  });
});

