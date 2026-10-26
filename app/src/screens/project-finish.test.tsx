import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { FINISH_UNDO_MS, ProjectMenu } from "./project-menu";

const rpc = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown }[] }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function statusCalls() {
  return rpc.calls.filter((call) => call.name === "upsert_project").map((call) => (call.args as { p_status: string }).p_status);
}

function ListProbe() {
  const location = useLocation();
  return <p>{`list ${String((location.state as { finishedOpen?: boolean } | null)?.finishedOpen === true)}`}</p>;
}

function renderMenu(finished: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/p1"]}>
          <Routes>
            <Route path="/projects" element={<ListProbe />} />
            <Route
              path="/projects/:projectId"
              element={<ProjectMenu projectId="p1" name="Oak Ridge" budget={null} finished={finished} sampleRow={{ id: "p1", pending_count: 0, deletable: false } as never} investmentTo="/projects/p1/investment" hasInvestment={false} />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "עוד" }));
  return screen.getByRole("dialog", { name: "Oak Ridge" });
}

describe("finishing a project (FLOW-961, decision 0213)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
  });

  it("finishes at once, opens the list with הסתיימו, and offers ביטול for 5s", async () => {
    const menu = renderMenu(false);
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    await waitFor(() => { expect(screen.getByText("list true")).toBeInTheDocument(); });
    expect(statusCalls()).toEqual(["finished"]);
    expect(FINISH_UNDO_MS).toBe(5000);
    const undo = await screen.findByRole("button", { name: "ביטול" });
    expect(screen.getByText("Oak Ridge עבר ל״הסתיימו״")).toBeInTheDocument();
    fireEvent.click(undo);
    await waitFor(() => { expect(statusCalls()).toEqual(["finished", "active"]); });
    expect(await screen.findByText("Oak Ridge חזר לפעילים")).toBeInTheDocument();
  });

  it("brings a finished project back at once, with no undo", async () => {
    const menu = renderMenu(true);
    fireEvent.click(within(menu).getByRole("button", { name: /^החזרה לפעילים/ }));
    expect(await screen.findByText("Oak Ridge חזר לפעילים")).toBeInTheDocument();
    expect(statusCalls()).toEqual(["active"]);
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^list/)).not.toBeInTheDocument();
  });
});
