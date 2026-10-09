import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { RolePreview } from "../use-is-viewer";
import { AddForm } from "./add-sheet";
import { EDITOR_CONNECTIONS_NOTE } from "./connections-screen";
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

describe("Settings by role (FLOW-601)", () => {
  it("gives the owner the צוות row with the count, after the Google row", async () => {
    renderAs("owner", <SettingsScreen sample={business} />, "/settings");
    const row = await screen.findByRole("link", { name: "צוות: 3" });
    expect(row).toHaveAttribute("href", "/settings/team");
    const google = screen.getByText("dana@example.com");
    expect(google.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "שם העסק: חברה לדוגמה" })).toBeInTheDocument();
  });

  it.each(["editor", "viewer"] as const)("keeps the team, the name and the currency from a %s", async (role) => {
    renderAs(role, <SettingsScreen sample={business} />, "/settings");
    expect(await screen.findByText("חברה לדוגמה")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /צוות/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /שם העסק/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /מטבע העסק/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /הגדרה ראשונה/ })).toBeNull();
  });

  it("lets an editor change the view switch", async () => {
    renderAs("editor", <SettingsScreen sample={business} />, "/settings");
    expect(await screen.findByRole("switch", { name: /רווח אחרי כלליות/ })).toBeEnabled();
  });
});

describe("Connections by role (FLOW-601)", () => {
  it("shows an editor the connectors read-only, and says why", async () => {
    renderAs("editor", <ConnectionsScreen sample={{ ...business, connected: false, mercuryConnected: false }} />, "/settings/connections");
    expect(await screen.findByText(EDITOR_CONNECTIONS_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SUMIT/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mercury/ })).toBeNull();
  });

  it("keeps the connectors open for the owner, with no note", async () => {
    renderAs("owner", <ConnectionsScreen sample={{ ...business, connected: false, mercuryConnected: false }} />, "/settings/connections");
    expect(await screen.findByRole("button", { name: /SUMIT/ })).toBeInTheDocument();
    expect(screen.queryByText(EDITOR_CONNECTIONS_NOTE)).toBeNull();
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
