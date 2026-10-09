import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { addBankState, AddForm, type AddBankState } from "./add-sheet";

// FLOW-331 r1: the bank row's states and targets, and Back after a quick action.
function Landed() {
  const location = useLocation();
  return <p>{`landed ${location.pathname}${location.search}`}</p>;
}

function renderAdd(bank: AddBankState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/add?preview=1"]}>
        <Routes>
          <Route path="/add" element={<AddForm bank={bank} />} />
          <Route path="/settings/connections" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("addBankState", () => {
  const status = (data?: { connected: boolean; last_error: string | null }, isLoading = false, isError = false) => ({ data, isLoading, isError });
  it("reads each Mercury status", () => {
    expect(addBankState(status(undefined, true))).toBe("unknown");
    expect(addBankState(status(undefined, false, true))).toBe("unknown");
    expect(addBankState(status({ connected: true, last_error: null }, true))).toBe("unknown");
    expect(addBankState(status({ connected: true, last_error: "auth" }))).toBe("reconnect");
    expect(addBankState(status({ connected: false, last_error: "auth" }))).toBe("reconnect");
    expect(addBankState(status({ connected: true, last_error: null }))).toBe("active");
    expect(addBankState(status({ connected: false, last_error: null }))).toBe("off");
  });
});

describe("AddForm bank row", () => {
  it.each([
    ["active", "landed /settings/connections?preview=1", "מחובר", null],
    ["off", "landed /settings/connections?preview=1&sheet=mercury", null, null],
    ["unknown", "landed /settings/connections?preview=1&sheet=mercury", null, null],
    ["reconnect", "landed /settings/connections?preview=1&sheet=mercury", null, "צריך לחבר מחדש"],
  ] as const)("%s", async (bank, target, connected, warning) => {
    renderAdd(bank);
    const row = await screen.findByRole("button", { name: /חיבור בנק/ });
    // Both are the row's hint line: "מחובר" muted, "צריך לחבר מחדש" in the warning tone.
    if (connected == null) expect(within(row).queryByText("מחובר")).not.toBeInTheDocument();
    else expect(within(row).getByText(connected)).toBeInTheDocument();
    if (warning == null) expect(within(row).queryByText("צריך לחבר מחדש")).not.toBeInTheDocument();
    else expect(within(row).getByText(warning)).toBeInTheDocument();
    expect(row.classList.contains("ui-row-tone-warning")).toBe(bank === "reconnect");
    fireEvent.click(row);
    expect(await screen.findByText(target)).toBeInTheDocument();
  });
});

describe("AddForm close (FLOW-339)", () => {
  it("closes with ✕ only: no ביטול button", async () => {
    renderAdd("off");
    expect(await screen.findByRole("button", { name: "סגירה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
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
    const view = renderBrowser("/review?preview=1");
    await quickAction(/פרויקט חדש/);
    expect(await screen.findByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/projects");
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(window.location.pathname).toBe("/review"); });
    expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("over Projects itself, one Back closes the project sheet and the next leaves Projects", async () => {
    window.history.replaceState(null, "", "/review?preview=1");
    window.history.pushState(null, "", "/projects?preview=1");
    const view = renderBrowser("/projects?preview=1");
    await quickAction(/פרויקט חדש/);
    expect(await screen.findByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/projects");
    window.history.back();
    await waitFor(() => { expect(window.location.pathname).toBe("/review"); });
    view.unmount();
  });

  it("over Loans itself, one Back closes the loan sheet and the next leaves Loans", async () => {
    window.history.replaceState(null, "", "/review?preview=1");
    window.history.pushState(null, "", "/settings/loans?preview=1");
    const view = renderBrowser("/settings/loans?preview=1");
    await quickAction(/הלוואה חדשה/);
    expect(await screen.findByRole("dialog", { name: /הלוואה/ })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /הלוואה/ })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/settings/loans");
    window.history.back();
    await waitFor(() => { expect(window.location.pathname).toBe("/review"); });
    view.unmount();
  });

  it("Back after + → הלוואה חדשה closes the loan sheet and keeps Loans", async () => {
    const view = renderBrowser("/review?preview=1");
    await quickAction(/הלוואה חדשה/);
    expect(await screen.findByRole("dialog", { name: /הלוואה/ })).toBeInTheDocument();
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /הלוואה/ })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/settings/loans");
    view.unmount();
    window.history.replaceState(null, "", "/");
  });
});
