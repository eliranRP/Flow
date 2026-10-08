import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { sheetStack } from "../ui/back";
import { ToastProvider } from "../ui/toast";
import {
  CompanyCurrencySheet,
  CURRENCY_FAILED,
  CURRENCY_REFUSED,
  CURRENCY_SAVED,
  CURRENCY_UNDONE,
} from "./company-currency-sheet";

type Answer = { error: { message: string; code?: string } | null };

function mockRpc(answer: (args: { p_currency: string }) => Answer | Promise<Answer>) {
  const calls: Array<{ name: string; args: { p_currency: string } }> = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: async (name: string, args: { p_currency: string }) => {
      calls.push({ name, args });
      return { data: null, ...(await answer(args)) };
    },
  } as never);
  return calls;
}

function Harness({ blocked, currency }: { blocked: () => boolean; currency: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <button type="button" onClick={() => { setOpen(true); }}>פתיחה</button>
      <CompanyCurrencySheet open={open} onOpenChange={setOpen} currency={currency} blocked={blocked} />
    </>
  );
}

function renderSheet(blocked: () => boolean = () => false, currency = "ILS") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const router = createMemoryRouter([{ path: "/settings", element: <Harness blocked={blocked} currency={currency} /> }], { initialEntries: ["/settings"] });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, invalidate };
}

function dollars(): HTMLElement {
  return screen.getByRole("radio", { name: "$ דולר" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompanyCurrencySheet (FLOW-504)", () => {
  it("writes the pick, spins its row, then closes through history with an undo toast", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const calls = mockRpc(async () => { await held; return { error: null }; });
    const { router, invalidate } = renderSheet();
    await waitFor(() => { expect(sheetStack(router.state.location.state)).toEqual(["company-currency"]); });
    fireEvent.click(dollars());
    await waitFor(() => { expect(dollars()).toHaveAttribute("aria-busy", "true"); });
    expect(screen.getByRole("radio", { name: "₪ שקל" })).toBeDisabled();
    fireEvent.click(dollars());
    release();
    await screen.findByText(CURRENCY_SAVED);
    expect(calls).toEqual([{ name: "set_company_currency", args: { p_currency: "USD" } }]);
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(sheetStack(router.state.location.state)).toEqual([]);
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["company-currency", "loan-currency", "dashboard", "project", "profit-months"]));
  });

  it("writes the previous currency back on ביטול, and holds a new pick until the undo lands", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const calls = mockRpc(async (args) => {
      if (args.p_currency === "USD") await held;
      return { error: null };
    });
    renderSheet(() => false, "USD");
    fireEvent.click(screen.getByRole("radio", { name: "₪ שקל" }));
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    fireEvent.click(await screen.findByRole("radio", { name: "₪ שקל" }));
    release();
    await screen.findByText(CURRENCY_UNDONE);
    expect(calls.map((call) => call.args.p_currency)).toEqual(["ILS", "USD"]);
  });

  it("keeps the sheet open and offers no retry when the owner check refuses", async () => {
    mockRpc(() => ({ error: { message: "forbidden", code: "42501" } }));
    renderSheet();
    fireEvent.click(dollars());
    await screen.findByText(CURRENCY_REFUSED);
    expect(screen.queryByRole("button", { name: "ניסיון חוזר", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(dollars()).toHaveAttribute("aria-checked", "false");
  });

  it("offers a retry for a dropped connection", async () => {
    mockRpc(() => ({ error: { message: "Failed to fetch" } }));
    renderSheet();
    fireEvent.click(dollars());
    await screen.findByText(CURRENCY_FAILED);
    expect(screen.getByRole("button", { name: "ניסיון חוזר", hidden: true })).toBeInTheDocument();
  });

  it("writes nothing in preview", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const blocked = vi.fn(() => true);
    renderSheet(blocked);
    fireEvent.click(dollars());
    expect(blocked).toHaveBeenCalled();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(calls).toEqual([]);
    expect(screen.getByText("open")).toBeInTheDocument();
  });
});
