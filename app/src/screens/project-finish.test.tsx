import type { ProjectsCashMonth } from "@flow/shared";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { FINISH_UNDO_MS, ProjectMenu } from "./project-menu";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  /** The next upsert's answer; a test holds it to see what the tap draws before the server answers. */
  answer: () => Promise.resolve({ data: null, error: null as { message: string } | null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return name === "upsert_project" ? rpc.answer() : Promise.resolve({ data: null, error: null });
    },
  }),
}));

function statusCalls() {
  return rpc.calls.filter((call) => call.name === "upsert_project").map((call) => (call.args as { p_status: string }).p_status);
}

const LIST_KEY = ["projects-cash", undefined, undefined];

function ListProbe() {
  const location = useLocation();
  // Subscribed to the list's read, so the row's status shows as the finish and its ביטול draw it.
  const list = useQuery<ProjectsCashMonth>({ queryKey: LIST_KEY, queryFn: () => Promise.reject(new Error("unread")), enabled: false });
  return <p>{`list ${String((location.state as { finishedOpen?: boolean } | null)?.finishedOpen === true)} ${String(list.data?.projects[0]?.status)}`}</p>;
}

function renderMenu(finished: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  // The list's month read, as the Projects list holds it: the finish draws the row as finished at once.
  client.setQueryData(LIST_KEY, { month: "2026-10-01", base_currency: "USD", projects: [{ id: "p1", name: "Oak Ridge", status: finished ? "finished" : "active" }] });
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
  return { client, menu: screen.getByRole("dialog", { name: "Oak Ridge" }) };
}

describe("finishing a project (FLOW-961, decision 0213)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
    rpc.answer = () => Promise.resolve({ data: null, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the list with הסתיימו and offers ביטול before the server answers, then ביטול brings it back", async () => {
    let answer: (value: { data: unknown; error: null }) => void = () => undefined;
    rpc.answer = () => new Promise((resolve) => { answer = resolve; });
    const { client, menu } = renderMenu(false);
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    // At once: the list, the row drawn as finished, and the toast, while the write is still out.
    expect(await screen.findByText("list true finished")).toBeInTheDocument();
    expect(screen.getByText("Oak Ridge עבר ל״הסתיימו״")).toBeInTheDocument();
    expect(statusCalls()).toEqual(["finished"]);
    act(() => { answer({ data: null, error: null }); });
    rpc.answer = () => Promise.resolve({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(statusCalls()).toEqual(["finished", "active"]); });
    expect(await screen.findByText("Oak Ridge חזר לפעילים")).toBeInTheDocument();
    expect(client.getQueryData<ProjectsCashMonth>(LIST_KEY)?.projects[0]?.status).toBe("active");
  });

  it("puts the row back and offers ניסיון חוזר when the finish fails", async () => {
    rpc.answer = () => Promise.resolve({ data: null, error: { message: "Failed to fetch" } });
    const { client, menu } = renderMenu(false);
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    expect(await screen.findByText("לא הצלחנו לעדכן את הפרויקט.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(client.getQueryData<ProjectsCashMonth>(LIST_KEY)?.projects[0]?.status).toBe("active");
    rpc.answer = () => Promise.resolve({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => { expect(statusCalls()).toEqual(["finished", "finished"]); });
  });

  it("takes the ביטול away after 5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { menu } = renderMenu(false);
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    expect(await screen.findByRole("button", { name: "ביטול" })).toBeInTheDocument();
    expect(FINISH_UNDO_MS).toBe(5000);
    await act(async () => { await vi.advanceTimersByTimeAsync(FINISH_UNDO_MS + 1000); });
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
    expect(statusCalls()).toEqual(["finished"]);
  });

  it("brings a finished project back at once, with no undo", async () => {
    const { menu } = renderMenu(true);
    fireEvent.click(within(menu).getByRole("button", { name: /^החזרה לפעילים/ }));
    expect(await screen.findByText("Oak Ridge חזר לפעילים")).toBeInTheDocument();
    expect(statusCalls()).toEqual(["active"]);
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^list/)).not.toBeInTheDocument();
  });
});
