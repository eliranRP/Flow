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

// The sheet also reads the company currency over the same client, so the save is the upsert call.
function upsertCalls() {
  return rpc.calls.filter((call) => call.name === "upsert_project");
}

function renderSheet(project?: Parameters<typeof ProjectFormSheet>[0]["project"], onCreated?: (id: string, name: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ProjectFormSheet open onOpenChange={() => undefined} project={project} onCreated={onCreated} />
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

  it("opens as a new project with only the name required, and says so on a tap with no name (FLOW-961)", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "פרויקט חדש" })).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "יצירת פרויקט" });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    const name = screen.getByRole("textbox", { name: "שם הפרויקט" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("צריך שם כדי ליצור את הפרויקט");
    expect(upsertCalls()).toHaveLength(0);
    fireEvent.change(name, { target: { value: "L" } });
    expect(name).not.toHaveAttribute("aria-invalid");
    fireEvent.click(create);
    expect(name).toHaveAccessibleDescription("השם צריך לפחות שתי אותיות");
    expect(upsertCalls()).toHaveLength(0);
  });

  it("puts the cursor in the name and announces why on a tap with no name (FLOW-1088)", () => {
    renderSheet();
    const create = screen.getByRole("button", { name: "יצירת פרויקט" });
    create.focus();
    fireEvent.click(create);
    const name = screen.getByRole("textbox", { name: "שם הפרויקט" });
    expect(name).toHaveFocus();
    expect(screen.getByText("צריך שם כדי ליצור את הפרויקט")).toHaveAttribute("aria-live", "polite");
  });

  it("creates a renovation (the first kind) with its purchase, budget and ARV, the kind stored as its type", async () => {
    renderSheet();
    expect(screen.getByRole("radio", { name: "שיפוץ" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט" }), { target: { value: "  Lark Hill  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "185000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "תקציב שיפוץ" }), { target: { value: "1500" } });
    fireEvent.change(screen.getByRole("textbox", { name: "שווי צפוי אחרי שיפוץ" }), { target: { value: "310000" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת פרויקט" }));
    await waitFor(() => { expect(rpc.calls.filter((call) => call.name === "set_project_investment")).toHaveLength(1); });
    expect(upsertCalls()[0]).toEqual({
      name: "upsert_project",
      args: { p_name: "Lark Hill", p_type: "שיפוץ", p_status: "active", p_budget_agorot: 150_000 },
    });
    expect(rpc.calls.find((call) => call.name === "set_project_investment")?.args).toEqual({
      p_project_id: "p9",
      p_patch: { purchase_minor: 18_500_000, arv_minor: 31_000_000 },
    });
  });

  it("the fields follow the kind: a rental, a client's contract, and none for overhead (FLOW-1044)", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "השכרה" }));
    expect(screen.getByRole("textbox", { name: "מחיר קנייה" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "שווי הנכס היום" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "תקציב שיפוץ" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "לקוח" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "תקורה" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "לקוח" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט" }), { target: { value: "Okafor" } });
    fireEvent.change(screen.getByRole("textbox", { name: "סכום החוזה" }), { target: { value: "1000000" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת פרויקט" }));
    await waitFor(() => { expect(upsertCalls()).toHaveLength(1); });
    expect(upsertCalls()[0]?.args).toEqual({ p_name: "Okafor", p_type: "לקוח", p_status: "active", p_budget_agorot: 100_000_000 });
    expect(rpc.calls.some((call) => call.name === "set_project_investment")).toBe(false);
  });

  it("a retry after the figures failed updates the project it made, never a second one, and assigns once (FLOW-1101)", async () => {
    let investmentTries = 0;
    rpc.impl = (name) => {
      if (name === "set_project_investment") {
        investmentTries += 1;
        if (investmentTries === 1) return Promise.resolve({ data: null, error: { message: "permission denied for table project_investments" } });
      }
      return Promise.resolve({ data: "p9", error: null });
    };
    const onCreated = vi.fn();
    renderSheet(undefined, onCreated);
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט" }), { target: { value: "Lark Hill" } });
    fireEvent.change(screen.getByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "185000" } });
    const create = screen.getByRole("button", { name: "יצירת פרויקט" });
    fireEvent.click(create);
    expect(await screen.findByText("הפרויקט נוצר, אבל הנתונים לא נשמרו. נסו שוב.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(create);
    await waitFor(() => { expect(onCreated).toHaveBeenCalledTimes(1); });
    expect(onCreated).toHaveBeenCalledWith("p9", "Lark Hill");
    expect(upsertCalls().map((call) => call.args)).toEqual([
      { p_name: "Lark Hill", p_type: "שיפוץ", p_status: "active" },
      { p_id: "p9", p_name: "Lark Hill", p_type: "שיפוץ", p_status: "active" },
    ]);
    const investments = rpc.calls.filter((call) => call.name === "set_project_investment");
    expect(investments).toHaveLength(2);
    expect(investments[1]?.args).toEqual({ p_project_id: "p9", p_patch: { purchase_minor: 18_500_000 } });
  });

  it("a failed figures save still refreshes the list, so the created project shows without a refetch wait (FLOW-1101)", async () => {
    rpc.impl = (name) => (name === "set_project_investment"
      ? Promise.resolve({ data: null, error: { message: "permission denied for table project_investments" } })
      : Promise.resolve({ data: "p9", error: null }));
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderSheet();
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט" }), { target: { value: "Lark Hill" } });
    fireEvent.change(screen.getByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "185000" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת פרויקט" }));
    expect(await screen.findByText("הפרויקט נוצר, אבל הנתונים לא נשמרו. נסו שוב.")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects-cash"] });
    invalidate.mockRestore();
  });

  it("edits an existing project under its id and keeps its own type words when the kind stays", async () => {
    renderSheet({ id: "p1", name: "Okafor", type: "flip", budget: null, status: "active" });
    expect(screen.getByRole("dialog", { name: "עריכת פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "שיפוץ" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(upsertCalls()).toHaveLength(1); });
    expect(upsertCalls()[0]).toEqual({
      name: "upsert_project",
      args: { p_id: "p1", p_name: "Okafor", p_type: "flip", p_status: "active" },
    });
  });
});
