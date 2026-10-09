import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen } from "./categories-screen";
import { parentChoices } from "./category-group";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  restoreRefusal: false,
  rehabOff: false,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, lines: 42, split_lines: 3, loan_used: false, rehab: rpc.rehabOff ? false : null, in_rehab: !rpc.rehabOff },
            { id: "c2", name: "קבלנים", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 31, split_lines: 0, loan_used: false, group_name: "חשבונות" },
            { id: "c3", name: "ביטוח נכס", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 18, split_lines: 0, loan_used: true },
            { id: "c4", name: "אחר", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 0, split_lines: 0, loan_used: false },
            { id: "c6", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal", lines: 2 },
            { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, excluded_from_pnl: false, lines: 7 },
          ],
          error: null,
        });
      }
      if (name === "set_category_rehab") {
        rpc.rehabOff = (args as { p_rehab: boolean | null }).p_rehab === false;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "set_category_group" && (args as { p_group_name: string }).p_group_name === "נפילה") {
        return Promise.resolve({ data: null, error: { message: "category not found", code: "P0001" } });
      }
      if (name === "rename_category" && (args as { p_name: string }).p_name === "קבלנים") {
        return Promise.resolve({ data: null, error: { message: "category already exists", code: "23505" } });
      }
      if (name === "delete_category") return Promise.resolve({ data: { deletion_id: "d1", name: "חומרים", lines: 42 }, error: null });
      if (name === "move_category_lines") return Promise.resolve({ data: { move_id: "m1", lines: 42 }, error: null });
      if (name === "restore_category" && rpc.restoreRefusal) {
        return Promise.resolve({ data: null, error: { message: "category cannot be restored", code: "23514" } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function renderScreen(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function calls(name: string) {
  return rpc.calls.filter((call) => call.name === name).map((call) => call.args);
}

async function openSheet(name: string) {
  renderScreen(<CategoriesScreen />);
  fireEvent.click(await screen.findByRole("button", { name: `עוד, ${name}` }));
  return screen.findByRole("dialog", { name });
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.restoreRefusal = false;
  rpc.rehabOff = false;
});

describe("category sheet: group (FLOW-401)", () => {
  it("shows the group row after שינוי שם with the current group", async () => {
    const sheet = await openSheet("קבלנים");
    const names = within(sheet).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const rename = names.findIndex((name) => name.includes("שינוי שם"));
    const group = names.findIndex((name) => name.startsWith("קטגוריית אב"));
    expect(group).toBe(rename + 1);
    expect(within(sheet).getByText("חשבונות")).toBeInTheDocument();
  });

  it("gives an income category the row too, and a loan category none (FLOW-406)", async () => {
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "עוד, תשלומי הלוואה" }));
    const loan = await screen.findByRole("dialog", { name: "תשלומי הלוואה" });
    expect(within(loan).queryByRole("button", { name: /^קטגוריית אב/ })).toBeNull();
    fireEvent.click(within(loan).getByRole("button", { name: "סגירה" }));
    fireEvent.click(await screen.findByRole("radio", { name: "הכנסות" }));
    fireEvent.click(await screen.findByRole("button", { name: "עוד, תקבול" }));
    const sheet = await screen.findByRole("dialog", { name: "תקבול" });
    expect(within(sheet).getByRole("button", { name: /^קטגוריית אב/ })).toBeInTheDocument();
  });

  it("offers the visible top-level categories of the same kind as parents (FLOW-406)", () => {
    const rows = [
      { id: "a", name: "חומרים", kind: "expense", hidden: false },
      { id: "b", name: "תחזוקה", kind: "expense", hidden: false },
      { id: "c", name: "חשמל", kind: "expense", hidden: false, parent_id: "b", group_name: "תחזוקה" },
      { id: "d", name: "ישנה", kind: "expense", hidden: true },
      { id: "e", name: "תשלומי הלוואה", kind: "expense", hidden: false, loan_part: "principal" },
      { id: "f", name: "שכירות", kind: "income", hidden: false },
    ];
    expect(parentChoices(rows[0] ?? null, rows)).toEqual(["תחזוקה"]);
    expect(parentChoices(rows[2] ?? null, rows)).toEqual(["חומרים", "תחזוקה"]);
  });

  it("applies a group on one tap, then ביטול puts the earlier one back", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await screen.findByRole("dialog", { name: "בחירת קטגוריית אב" });
    expect(within(picker).getByRole("radio", { name: "בלי קטגוריית אב" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(picker).getByRole("radio", { name: "חשבונות" }));
    await waitFor(() => { expect(calls("set_category_group")).toEqual([{ p_category_id: "c1", p_group_name: "חשבונות" }]); });
    expect(await screen.findByText("קטגוריית האב נשמרה")).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "בחירת קטגוריית אב" })).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => { expect(calls("set_category_group")).toHaveLength(2); });
    expect(calls("set_category_group")[1]).toEqual({ p_category_id: "c1", p_group_name: "" });
  });

  it("clears a group with בלי קטגוריית אב", async () => {
    const sheet = await openSheet("קבלנים");
    fireEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await screen.findByRole("dialog", { name: "בחירת קטגוריית אב" });
    fireEvent.click(within(picker).getByRole("radio", { name: "בלי קטגוריית אב" }));
    await waitFor(() => { expect(calls("set_category_group")).toEqual([{ p_category_id: "c2", p_group_name: "" }]); });
  });

  it("closes without a write on the current group", async () => {
    const sheet = await openSheet("קבלנים");
    fireEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await screen.findByRole("dialog", { name: "בחירת קטגוריית אב" });
    fireEvent.click(within(picker).getByRole("radio", { name: "חשבונות" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "בחירת קטגוריית אב" })).toBeNull(); });
    expect(calls("set_category_group")).toHaveLength(0);
  });

  it("makes a new group from one field, and refuses an empty name", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await screen.findByRole("dialog", { name: "בחירת קטגוריית אב" });
    fireEvent.click(within(picker).getByRole("button", { name: "קטגוריית אב חדשה" }));
    const field = await within(picker).findByLabelText("שם הקטגוריה");
    fireEvent.click(within(picker).getByRole("button", { name: "שמירה" }));
    expect(await within(picker).findByText("צריך שם לקטגוריה")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "  חומרי   גמר " } });
    fireEvent.click(within(picker).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(calls("set_category_group")).toEqual([{ p_category_id: "c1", p_group_name: "חומרי גמר" }]); });
  });

  it("keeps the picker open and says why when the write fails", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await screen.findByRole("dialog", { name: "בחירת קטגוריית אב" });
    fireEvent.click(within(picker).getByRole("button", { name: "קטגוריית אב חדשה" }));
    fireEvent.change(await within(picker).findByLabelText("שם הקטגוריה"), { target: { value: "נפילה" } });
    fireEvent.click(within(picker).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("הקטגוריה לא נמצאה.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "בחירת קטגוריית אב" })).toBeInTheDocument();
  });
});
