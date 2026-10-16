import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectFormSheet } from "./project-form-sheet";

const rpc = vi.hoisted(() => ({
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: "p9", error: null }),
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

function renderSheet(project?: Parameters<typeof ProjectFormSheet>[0]["project"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ProjectFormSheet open onOpenChange={() => undefined} project={project} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("the project sheet (FLOW-445)", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
    rpc.impl = () => Promise.resolve({ data: "p9", error: null });
  });

  it("opens as a new project with only the name required", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "פרויקט חדש" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת פרויקט" })).toBeDisabled();
  });

  it("creates a project with the trimmed name, an active status and the budget in agorot", async () => {
    renderSheet();
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט" }), { target: { value: "  Lark Hill  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "תקציב (אופציונלי)" }), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת פרויקט" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(rpc.calls[0]).toEqual({
      name: "upsert_project",
      args: { p_name: "Lark Hill", p_type: "", p_status: "active", p_budget_agorot: 150_000 },
    });
  });

  it("edits an existing project under its id and keeps the stored values on screen", async () => {
    renderSheet({ id: "p1", name: "Okafor", type: "flip", budget: null });
    expect(screen.getByRole("dialog", { name: "עריכת פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סוג (אופציונלי)" })).toHaveValue("flip");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(rpc.calls[0]).toEqual({
      name: "upsert_project",
      args: { p_id: "p1", p_name: "Okafor", p_type: "flip", p_status: "active" },
    });
  });
});
