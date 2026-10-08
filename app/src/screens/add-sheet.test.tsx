import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
  ] as const)("%s", async (bank, target, meta, hint) => {
    renderAdd(bank);
    const row = await screen.findByRole("button", { name: /חיבור בנק/ });
    if (meta == null) expect(within(row).queryByText("מחובר")).not.toBeInTheDocument();
    else expect(within(row).getByText(meta)).toBeInTheDocument();
    if (hint == null) expect(within(row).queryByText("צריך לחבר מחדש")).not.toBeInTheDocument();
    else expect(within(row).getByText(hint)).toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByText(target)).toBeInTheDocument();
  });
});

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate(-1); }}>test-back</button>;
}

describe("+ quick action history", () => {
  it("Back after + → פרויקט חדש leaves Projects for the screen before +, not the + sheet", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/review?preview=1", "/add?preview=1"]} initialIndex={1}>
          <App />
          <BackButton />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /פרויקט חדש/ }));
    const dialog = await screen.findByRole("dialog", { name: "פרויקט" });
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "test-back" }));
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "פרויקטים", hidden: true })).not.toBeInTheDocument(); });
    expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
  });
});
