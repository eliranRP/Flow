import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { backend, DASHBOARD, resetBackend, serve } from "./connection-page-test-backend";
import { ConnectionsScreen } from "./connections-screen";
import { ConnectionDetailPage } from "./connection-pages";
import { SettingsScreen } from "./settings-screen";

vi.mock("../lib/supabase", async () => (await import("./connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("./connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

function Place() {
  const location = useLocation();
  return <p data-testid="place">{`${location.pathname}${location.search}`}</p>;
}

function renderRoutes(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/settings/connections" element={<ConnectionsScreen />} />
        <Route path="/settings/connections/sumit" element={<ConnectionDetailPage provider="sumit" />} />
        <Route path="/settings/connections/mercury" element={<ConnectionDetailPage provider="mercury" />} />
        <Route path="/settings/connections/ai" element={<h1>AI page</h1>} />
        <Route path="/setup/1" element={<h1>צעד העסק</h1>} />
        <Route path="/" element={<h1>בית</h1>} />
      </Routes>
      <Place />
    </>,
    { route },
  );
}

const where = () => screen.getByTestId("place").textContent;

describe("old ?sheet= links land on the connection pages (FLOW-918)", () => {
  it.each([
    ["/settings?sheet=sumit&preview=1", "/settings/connections/sumit?preview=1"],
    ["/settings?sheet=mercury", "/settings/connections/mercury"],
    ["/settings/connections?sheet=sumit&preview=1", "/settings/connections/sumit?preview=1"],
    ["/settings/connections?sheet=mercury", "/settings/connections/mercury"],
    ["/settings/connections?sheet=assistant&preview=1", "/settings/connections/ai?preview=1"],
  ])("moves %s to %s, keeping the preview flag and dropping sheet", async (from, to) => {
    serve({});
    renderRoutes(from);
    await waitFor(() => { expect(where()).toBe(to); });
  });

  it("opens no connection page for a sheet name that is not a connector", async () => {
    serve({});
    renderRoutes("/settings/connections?sheet=disconnect");
    expect(await screen.findByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    expect(where()).toBe("/settings/connections?sheet=disconnect");
  });
});

describe("Back from a connection page (FLOW-918)", () => {
  it.each([
    ["/settings/connections/sumit?preview=1", "/settings/connections?preview=1"],
    ["/settings/connections/mercury?preview=1", "/settings/connections?preview=1"],
  ])("goes from %s to the connections list with the preview flag", async (from, to) => {
    serve({});
    renderRoutes(from);
    fireEvent.click(await screen.findByRole("button", { name: /^חזרה/ }));
    await waitFor(() => { expect(where()).toBe(to); });
  });

  it("goes to the plain connections list when there is no preview", async () => {
    serve({});
    renderRoutes("/settings/connections/sumit");
    fireEvent.click(await screen.findByRole("button", { name: /^חזרה/ }));
    await waitFor(() => { expect(where()).toBe("/settings/connections"); });
  });
});

describe("the page without a business (FLOW-918)", () => {
  function serveForm(company: string | null) {
    serve({});
    const live = backend.answer;
    backend.answer = (name, args) => {
      if (name === "get_dashboard") return Promise.resolve({ data: { ...DASHBOARD, company_id: company }, error: null });
      return live(name, args);
    };
  }

  it("sends a business-less visit to the setup's business step", async () => {
    serveForm(null);
    renderRoutes("/settings/connections/sumit");
    fireEvent.click(await screen.findByRole("link", { name: "פרטי העסק" }));
    await waitFor(() => { expect(where()).toBe("/setup/1"); });
  });
});
