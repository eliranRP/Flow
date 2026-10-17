import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { AddForm } from "./add-sheet";

// FLOW-331 r1: Back after a quick action.
function Landed() {
  const location = useLocation();
  return <p>{`landed ${location.pathname}${location.search}`}</p>;
}

function renderAdd() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/add?preview=1"]}>
        <Routes>
          <Route path="/add" element={<AddForm />} />
          <Route path="/settings/connections" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddForm rows", () => {
  it("offers no bank row to anyone: connecting a bank stays in Settings", async () => {
    renderAdd();
    expect(await screen.findByRole("button", { name: /פרויקט חדש/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /הלוואה חדשה/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /חיבור בנק/ })).toBeNull();
  });

  it("draws the rows as text and a chevron, with no icon", async () => {
    renderAdd();
    const row = await screen.findByRole("button", { name: /הלוואה חדשה/ });
    expect(row.querySelector(".ui-row-icon")).toBeNull();
  });
});

describe("+ quick action history", () => {
  // Real browser history: a sheet's Back layer pops only with a browser index (MemoryRouter drops it in place).
  function renderBrowser(start: string) {
    window.history.replaceState(null, "", start);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>,
    );
  }

  async function quickAction(name: RegExp) {
    fireEvent.click(await screen.findByRole("link", { name: "הוספה" }));
    fireEvent.click(await screen.findByRole("button", { name }));
  }

  it("Back after + → פרויקט חדש closes the sheet, then leaves Projects for the screen before +", async () => {
    const view = renderBrowser("/?preview=1");
    await quickAction(/פרויקט חדש/);
    expect(await screen.findByRole("dialog", { name: "פרויקט חדש" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט חדש" })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/projects");
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(window.location.pathname).toBe("/"); });
    expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("Back after + → הלוואה חדשה closes the loan sheet and keeps Loans", async () => {
    const view = renderBrowser("/?preview=1");
    await quickAction(/הלוואה חדשה/);
    expect(await screen.findByRole("dialog", { name: /הלוואה/ })).toBeInTheDocument();
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /הלוואה/ })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/loans");
    view.unmount();
    window.history.replaceState(null, "", "/");
  });
});
