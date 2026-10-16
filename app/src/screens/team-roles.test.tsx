import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { RolePreview } from "../use-is-viewer";
import { VIEWER_NOTE } from "../company-role-cache";
import { AddForm } from "./add-sheet";
import { BusinessScreen } from "./business-screen";
import { ConnectionDetailPage } from "./connection-pages";
import { ConnectionsScreen, SettingsScreen } from "./flow-screens";
import type { SettingsSample } from "./settings-screen";

// FLOW-601: an editor gets every bookkeeping write; the owner keeps the business, its
// connectors, setup and the team (mockup a-1-settings: only the owner sees צוות).

const business: SettingsSample = {
  name: "חברה לדוגמה",
  connected: true,
  companyId: 1000,
  lastError: null,
  email: "dana@example.com",
  mercuryConnected: true,
  jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
  assistant: { state: "empty" },
  teamCount: 3,
};

function renderAs(role: "owner" | "editor" | "viewer", ui: ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[path]}>
            <RolePreview role={role}>
              <Routes>
                <Route path="*" element={ui} />
              </Routes>
            </RolePreview>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Settings by role (FLOW-601, FLOW-512)", () => {
  it("gives the owner the צוות row with the count, after the business row", async () => {
    renderAs("owner", <SettingsScreen sample={business} />, "/settings");
    const row = await screen.findByRole("link", { name: /^צוות/ });
    expect(row).toHaveAttribute("href", "/settings/team");
    const business_ = screen.getByRole("link", { name: /^העסק/ });
    expect(business_).toHaveAttribute("href", "/settings/business");
    expect(business_.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The company's name, currency and date live on the business page, not in the menu.
    expect(screen.queryByRole("button", { name: /שם העסק/ })).toBeNull();
  });

  it.each(["editor", "viewer"] as const)("keeps the team out of the menu for a %s, and the business page open", async (role) => {
    renderAs(role, <SettingsScreen sample={business} />, "/settings");
    expect(await screen.findByText("חברה לדוגמה")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^צוות/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^העסק/ })).toHaveAttribute("href", "/settings/business");
    expect(screen.queryByRole("link", { name: /הגדרה ראשונה/ })).toBeNull();
  });
});

describe("Business page by role (FLOW-601, FLOW-512)", () => {
  it("keeps the overhead switch to the owner: an editor sees it locked", async () => {
    renderAs("editor", <BusinessScreen sample={business} />, "/settings/business");
    expect(await screen.findByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("lets the owner change the overhead switch", async () => {
    renderAs("owner", <BusinessScreen sample={business} />, "/settings/business");
    expect(await screen.findByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the name, the currency and the date as rows without a way to change them for a viewer", async () => {
    renderAs("viewer", <BusinessScreen sample={business} />, "/settings/business");
    expect(await screen.findByText("רווח ותזרים לפי")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /שם העסק/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /מטבע העסק/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /רווח ותזרים לפי/ })).toBeNull();
    expect(screen.getByRole("switch", { name: /רווח אחרי הוצאות כלליות/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Connections by role (FLOW-601, FLOW-512)", () => {
  it("shows an editor the connectors, and the SUMIT page says only the owner connects", async () => {
    renderAs("editor", <ConnectionsScreen sample={{ ...business, connected: false, mercuryConnected: false }} />, "/settings/connections");
    expect(await screen.findByRole("link", { name: /SUMIT/ })).toBeInTheDocument();
  });

  it("gives an editor no connect form on the SUMIT page, and says why", async () => {
    renderAs("editor", <ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />, "/settings/connections/sumit");
    expect(await screen.findByText("רק הבעלים יכולים לחבר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חיבור" })).toBeNull();
  });

  it("keeps the connectors open for the owner, with no note", async () => {
    renderAs("owner", <ConnectionsScreen sample={{ ...business, connected: false, mercuryConnected: false }} />, "/settings/connections");
    expect(await screen.findByRole("link", { name: /SUMIT/ })).toBeInTheDocument();
    expect(screen.queryByText(VIEWER_NOTE)).toBeNull();
  });
});

describe("Add sheet by role (FLOW-601)", () => {
  it("gives an editor new projects and loans, but not a bank connection", async () => {
    renderAs("editor", <AddForm bank="off" />, "/add?preview=1");
    expect(await screen.findByRole("button", { name: /פרויקט חדש/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /הלוואה חדשה/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /חיבור בנק/ })).toBeNull();
  });

  it("keeps the bank row for the owner", async () => {
    renderAs("owner", <AddForm bank="off" />, "/add?preview=1");
    expect(await screen.findByRole("button", { name: /חיבור בנק/ })).toBeInTheDocument();
  });
});
