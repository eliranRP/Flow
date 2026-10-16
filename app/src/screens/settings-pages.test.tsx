import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { connectionsHint, ConnectionsScreen, LoansScreen, SettingsScreen } from "./flow-screens";

// FLOW-501, FLOW-512. Settings is a menu: the business, connections, team, notifications and
// categories rows open pages. The loans list still lives at /settings/loans.

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

/** The row's visible value (its hint), read from the link's text after its title. */
function valueOf(link: HTMLElement): string {
  return link.textContent ?? "";
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
    ])).toEqual({ kind: "attention", text: "Mercury צריך חיבור" });
    expect(connectionsHint([
      { name: "SUMIT", state: "reconnect" },
      { name: "עוזר AI", state: "reconnect" },
    ])).toEqual({ kind: "attention", text: "2 צריכים חיבור" });
  });

  it("never guesses a count while one status loads or fails", () => {
    expect(connectionsHint([{ name: "SUMIT", state: "loading" }, { name: "Mercury", state: "error" }])).toEqual({ kind: "loading" });
    expect(connectionsHint([{ name: "SUMIT", state: "active" }, { name: "Mercury", state: "error" }])).toEqual({ kind: "error" });
  });
});

describe("Settings rows", () => {
  it("does not count Jev as active when the server holds no key (FLOW-348 A)", () => {
    const on = { ...business.jev, enabled: true };
    const { unmount } = renderAt(<SettingsScreen sample={{ ...business, jev: on }} />);
    expect(valueOf(screen.getByRole("link", { name: /^חיבורים/ }))).toContain("4 פעילים");
    unmount();
    renderAt(<SettingsScreen sample={{ ...business, jev: { ...on, keyMissing: true } }} />);
    expect(valueOf(screen.getByRole("link", { name: /^חיבורים/ }))).toContain("3 פעילים");
  });

  it("opens the connections page from the menu, and the loans list is not in the menu", () => {
    renderAt(<SettingsScreen sample={{ ...business, loans: twoLoans }} />);
    const connections = screen.getByRole("link", { name: /^חיבורים/ });
    expect(connections).toHaveAttribute("href", "/settings/connections");
    expect(valueOf(connections)).toContain("3 פעילים");
    expect(connections.querySelector(".ui-row-value-signal")).toBeNull();
    expect(screen.queryByRole("link", { name: /^הלוואות/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "חיבורים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
  });

  it("names a broken connector in the signal tone", () => {
    renderAt(<SettingsScreen sample={{ ...business, mercuryLastError: "auth" }} />);
    const connections = screen.getByRole("link", { name: /^חיבורים/ });
    expect(valueOf(connections)).toContain("Mercury צריך חיבור");
    expect(connections.querySelector(".ui-row-value-signal")).not.toBeNull();
  });

  it("counts two broken connectors", () => {
    renderAt(<SettingsScreen sample={{ ...business, lastError: "sumit_auth", assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />);
    expect(valueOf(screen.getByRole("link", { name: /^חיבורים/ }))).toContain("2 צריכים חיבור");
  });

  it("shows a skeleton hint while a status loads and a short failure without a retry", () => {
    const loading = renderAt(<SettingsScreen sample={{ ...business, mercury: "loading" }} />);
    expect(screen.getByRole("link", { name: /^חיבורים/ }).querySelector("[class*='ui-skel']")).not.toBeNull();
    loading.unmount();
    renderAt(<SettingsScreen sample={{ ...business, sumit: "error" }} />);
    expect(valueOf(screen.getByRole("link", { name: /^חיבורים/ }))).toContain("לא הצלחנו לטעון");
    expect(screen.queryByRole("button", { name: /ניסיון חוזר/ })).not.toBeInTheDocument();
  });

  it("reads an expired connector as off for a viewer, who cannot reconnect it", () => {
    renderAt(
      <ViewerPreview>
        <SettingsScreen sample={{ ...business, mercuryLastError: "auth" }} />
      </ViewerPreview>,
    );
    const connections = screen.getByRole("link", { name: /^חיבורים/ });
    expect(valueOf(connections)).toContain("2 פעילים");
    expect(connections.querySelector(".ui-row-value-signal")).toBeNull();
  });

  it("shows no connections count with no company", () => {
    renderAt(<SettingsScreen sample={{ ...business, name: null, noCompany: true }} />);
    expect(screen.queryByRole("link", { name: /^חיבורים/ })).not.toBeInTheDocument();
  });
});

describe("Settings redirects", () => {
  it.each([
    ["sumit", "/settings/connections/sumit"],
    ["mercury", "/settings/connections/mercury"],
    ["assistant", "/settings/connections"],
  ])("moves /settings?sheet=%s to the connections pages", async (sheet, path) => {
    const sample = { ...business, connected: false, companyId: null, mercuryConnected: false, assistant: { state: "empty" as const } };
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <SettingsScreen sample={sample} /> },
        { path: "/settings/connections", element: <ConnectionsScreen sample={sample} /> },
        { path: "/settings/connections/sumit", element: <h1>SUMIT page</h1> },
        { path: "/settings/connections/mercury", element: <h1>Mercury page</h1> },
      ],
      { initialEntries: [`/settings?sheet=${sheet}`] },
    );
    render(providers(<RouterProvider router={router} />));
    await waitFor(() => { expect(router.state.location.pathname).toBe(path); });
    expect(router.state.location.search).not.toContain("sheet=");
  });

  it("returns focus to the Settings row on Back from a page", async () => {
    const router = createMemoryRouter(
      [
        { path: "/settings", element: <SettingsScreen sample={business} /> },
        { path: "/settings/connections", element: <ConnectionsScreen sample={business} /> },
      ],
      { initialEntries: ["/settings"] },
    );
    render(providers(<RouterProvider router={router} />));
    fireEvent.click(screen.getByRole("link", { name: /^חיבורים/ }));
    expect(await screen.findByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(screen.getByRole("link", { name: /^חיבורים/ })).toHaveFocus(); });
  });

  it("does not move focus on a fresh visit to Settings", async () => {
    renderAt(<SettingsScreen sample={business} />);
    await new Promise((resolve) => { window.setTimeout(resolve, 20); });
    expect(screen.getByRole("link", { name: /^חיבורים/ })).not.toHaveFocus();
  });
});

describe("Connections page", () => {
  it("groups the connectors under בנק וספרים and עזרים, in that order", () => {
    renderAt(<ConnectionsScreen sample={business} />, "/settings/connections");
    expect(screen.getByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    const books = screen.getByText("בנק וספרים");
    const helpers = screen.getByText("עזרים");
    const mercury = screen.getByRole("link", { name: /^Mercury/ });
    const sumit = screen.getByRole("link", { name: /^SUMIT/ });
    const ai = screen.getByRole("link", { name: /^חיבור ל־AI/ });
    const order = [books, mercury, sumit, helpers, ai];
    for (let index = 1; index < order.length; index += 1) {
      const before = order[index - 1];
      const after = order[index];
      if (before == null || after == null) throw new Error("order");
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
  });

  it("keeps the connector rows open to read for a viewer, with no connect action", () => {
    renderAt(
      <ViewerPreview>
        <ConnectionsScreen sample={{ ...business, connected: false, mercuryConnected: false }} />
      </ViewerPreview>,
      "/settings/connections",
    );
    expect(screen.getByRole("link", { name: /^SUMIT/ })).toHaveAttribute("href", "/settings/connections/sumit");
    expect(screen.getByRole("link", { name: /^Mercury/ })).toHaveAttribute("href", "/settings/connections/mercury");
  });

  it("shows no connector values with no company", () => {
    renderAt(<ConnectionsScreen sample={{ ...business, name: null, noCompany: true, assistant: { state: "no-company" } }} />, "/settings/connections");
    expect(screen.getByRole("link", { name: /^SUMIT/ })).toHaveTextContent("אין עסק עדיין");
    expect(screen.queryByRole("link", { name: /^חיבור ל־AI/ })).not.toBeInTheDocument();
  });
});

describe("Loans page", () => {
  it("lists the balances with cents and a new-loan row for the owner", () => {
    renderAt(<LoansScreen sample={{ ...business, loans: twoLoans }} />, "/settings/loans");
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא אלון, \$200,000,/ })).toBeInTheDocument();
    expect(screen.getByText("ממתין לבדיקה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הלוואה חדשה" })).toBeInTheDocument();
  });

  it("lets a viewer read the balances and open a loan's page, with no new loan (FLOW-106 B)", () => {
    renderAt(
      <ViewerPreview>
        <LoansScreen sample={{ ...business, loans: twoLoans }} />
      </ViewerPreview>,
      "/settings/loans",
    );
    expect(screen.getByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.getByText("הלוואת ציוד")).toBeInTheDocument();
    // The loan page reads as static rows for a viewer, so the list row still opens it.
    expect(screen.getByRole("button", { name: /^משכנתא אלון, / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הלוואה חדשה" })).not.toBeInTheDocument();
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

