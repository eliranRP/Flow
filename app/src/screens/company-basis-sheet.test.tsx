import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { sheetStack } from "../ui/back";
import type { BasisChoice } from "../ui/basis-sheet";
import { ToastProvider } from "../ui/toast";
import { BASIS_FAILED, BASIS_REFUSED, BASIS_SAVED, BASIS_UNDONE, CompanyBasisSheet } from "./company-basis-sheet";

type Answer = { error: { message: string; code?: string } | null };

function mockRpc(answer: (args: { p_basis: string }) => Answer | Promise<Answer>) {
  const calls: Array<{ name: string; args: { p_basis: string } }> = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: async (name: string, args: { p_basis: string }) => {
      calls.push({ name, args });
      return { data: null, ...(await answer(args)) };
    },
  } as never);
  return calls;
}

function Harness({ blocked, basis }: { blocked: () => boolean; basis: BasisChoice }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <button type="button" onClick={() => { setOpen(true); }}>פתיחה</button>
      <CompanyBasisSheet open={open} onOpenChange={setOpen} basis={basis} blocked={blocked} />
    </>
  );
}

function renderSheet(blocked: () => boolean = () => false, basis: BasisChoice = "cash") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const router = createMemoryRouter([{ path: "/settings", element: <Harness blocked={blocked} basis={basis} /> }], { initialEntries: ["/settings"] });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, invalidate };
}

const invoice = () => screen.getByRole("radio", { name: /^תאריך חשבונית/ });
const payment = () => screen.getByRole("radio", { name: /^תאריך תשלום/ });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompanyBasisSheet (FLOW-103)", () => {
  it("writes the company's word for the pick, closes through history and refetches every P&L read", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const { router, invalidate } = renderSheet();
    await waitFor(() => { expect(sheetStack(router.state.location.state)).toEqual(["company-basis"]); });
    fireEvent.click(invoice());
    await screen.findByText(BASIS_SAVED);
    expect(calls).toEqual([{ name: "set_cash_basis", args: { p_basis: "invoice" } }]);
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(sheetStack(router.state.location.state)).toEqual([]);
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["dashboard", "project", "project-category", "profit-months", "breakdown", "breakdown-lines"]));
  });

  it("drops the project figures saved on the phone, which count by the old date (FLOW-804)", async () => {
    mockRpc(() => ({ error: null }));
    localStorage.setItem("flow-project-reads", JSON.stringify({ user: "u", company: "c", entries: [] }));
    renderSheet();
    fireEvent.click(invoice());
    await screen.findByText(BASIS_SAVED);
    expect(localStorage.getItem("flow-project-reads")).toBeNull();
  });

  it("writes the previous basis back on ביטול", async () => {
    const calls = mockRpc(() => ({ error: null }));
    renderSheet(() => false, "invoiced");
    fireEvent.click(payment());
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await screen.findByText(BASIS_UNDONE);
    expect(calls.map((call) => call.args.p_basis)).toEqual(["paid", "invoice"]);
  });

  it("keeps the sheet open and offers no retry when the owner check refuses", async () => {
    mockRpc(() => ({ error: { message: "forbidden", code: "42501" } }));
    renderSheet();
    fireEvent.click(invoice());
    await screen.findByText(BASIS_REFUSED);
    expect(screen.queryByRole("button", { name: "ניסיון חוזר", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("offers a retry for a dropped connection", async () => {
    mockRpc(() => ({ error: { message: "Failed to fetch" } }));
    renderSheet();
    fireEvent.click(invoice());
    await screen.findByText(BASIS_FAILED);
    expect(screen.getByRole("button", { name: "ניסיון חוזר", hidden: true })).toBeInTheDocument();
  });

  it("writes nothing in preview", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const blocked = vi.fn(() => true);
    renderSheet(blocked);
    fireEvent.click(invoice());
    expect(blocked).toHaveBeenCalled();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(calls).toEqual([]);
  });
});
