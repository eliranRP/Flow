import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen } from "./categories-screen";

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
            { id: "c2", name: "קבלנים", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 31, split_lines: 0, loan_used: false },
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

describe("category sheet: move all lines and delete (FLOW-405)", () => {
  it("orders the rows and keeps delete last", async () => {
    const sheet = await openSheet("חומרים");
    const names = within(sheet).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const move = names.findIndex((name) => name.includes("העברה לקטגוריה אחרת"));
    const hide = names.findIndex((name) => name.includes("הסתרה"));
    const remove = names.findIndex((name) => name.includes("מחיקה"));
    expect(move).toBeGreaterThan(-1);
    expect(move).toBeLessThan(hide);
    expect(hide).toBeLessThan(remove);
    // FLOW-341: one move row, and no row carries a sentence.
    expect(names.filter((name) => name.includes("מיזוג"))).toEqual([]);
    expect(sheet.querySelectorAll(".t-hint")).toHaveLength(0);
    expect(within(sheet).getByRole("switch", { name: "נספרת בשיפוץ" })).toBeChecked();
  });

  it("moves all lines on one tap, then ביטול undoes that move", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "העברה לקטגוריה אחרת" }));
    const picker = await screen.findByRole("dialog", { name: "העברת 42 תנועות אל" });
    expect(within(picker).getByRole("switch", { name: "להסתיר את חומרים" })).not.toBeChecked();
    expect(within(picker).queryByRole("button", { name: /תקבול/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: /^חומרים/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: /תשלומי הלוואה/ })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: /קבלנים/ }));
    await waitFor(() => { expect(calls("move_category_lines")).toEqual([{ p_from: "c1", p_into: "c2" }]); });
    expect(await screen.findByText("42 תנועות הועברו מחומרים אל קבלנים")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(calls("undo_category_move")).toEqual([{ p_move_id: "m1" }]); });
  });

  it("merges instead when the picker's hide switch is on (FLOW-341)", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "העברה לקטגוריה אחרת" }));
    const picker = await screen.findByRole("dialog", { name: "העברת 42 תנועות אל" });
    fireEvent.click(within(picker).getByRole("switch", { name: "להסתיר את חומרים" }));
    fireEvent.click(within(picker).getByRole("button", { name: /קבלנים/ }));
    const confirm = await screen.findByRole("dialog", { name: "למזג את הקטגוריה?" });
    expect(within(confirm).getByText("חומרים ← קבלנים")).toBeInTheDocument();
    expect(within(confirm).getByText("התנועות עוברות אל היעד, וחומרים מוסתרת. אי אפשר להפריד אחר כך.")).toBeInTheDocument();
    expect(calls("move_category_lines")).toEqual([]);
    // A merge is not a delete: no bin on its button.
    expect(within(confirm).getByRole("button", { name: "מיזוג" }).querySelector("svg")).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "מיזוג" }));
    await waitFor(() => { expect(calls("merge_category")).toEqual([{ p_from: "c1", p_into: "c2" }]); });
  });

  it("confirms a hide with a neutral button, since a hide can be undone (FLOW-341)", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "הסתרה" }));
    const confirm = await screen.findByRole("dialog", { name: "להסתיר את הקטגוריה?" });
    const button = within(confirm).getByRole("button", { name: "הסתרה" });
    expect(button.querySelector("svg")).toBeNull();
    expect(button.className).not.toMatch(/danger/);
  });

  it("an empty category can only merge, with no switch", async () => {
    const sheet = await openSheet("אחר");
    fireEvent.click(within(sheet).getByRole("button", { name: "העברה לקטגוריה אחרת" }));
    const picker = await screen.findByRole("dialog", { name: "מיזוג אל" });
    expect(within(picker).queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: /קבלנים/ }));
    expect(await screen.findByRole("dialog", { name: "למזג את הקטגוריה?" })).toBeInTheDocument();
  });

  it("confirms a delete with the counts, then ביטול restores the category", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "מחיקה" }));
    const confirm = await screen.findByRole("dialog", { name: "למחוק את הקטגוריה?" });
    expect(within(confirm).getByText("חומרים · 42 תנועות")).toBeInTheDocument();
    expect(within(confirm).getByText("3 מהן מפוצלות, והפיצול שלהן יימחק. ספקים שזכרו את הקטגוריה ישכחו אותה.")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(calls("delete_category")).toEqual([{ p_category_id: "c1" }]); });
    expect(await screen.findByText("חומרים נמחקה. 42 תנועות חזרו ללשונית לאישור")).toBeInTheDocument();
    rpc.restoreRefusal = true;
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(calls("restore_category")).toEqual([{ p_category_id: "c1" }]); });
    expect(await screen.findByText("אי אפשר לבטל: תנועה סווגה מחדש בינתיים.")).toBeInTheDocument();
  });

  it("offers the move instead of the delete", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "מחיקה" }));
    const confirm = await screen.findByRole("dialog", { name: "למחוק את הקטגוריה?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "להעביר את התנועות לקטגוריה אחרת במקום" }));
    expect(await screen.findByRole("dialog", { name: "העברת 42 תנועות אל" })).toBeInTheDocument();
    expect(calls("delete_category")).toEqual([]);
  });

  it("an empty category has no count, no split line and no move link", async () => {
    const sheet = await openSheet("אחר");
    fireEvent.click(within(sheet).getByRole("button", { name: "מחיקה" }));
    const confirm = await screen.findByRole("dialog", { name: "למחוק את הקטגוריה?" });
    expect(within(confirm).getByText("אחר · אין תנועות")).toBeInTheDocument();
    expect(within(confirm).getByText("הקטגוריה תימחק מהרשימה.")).toBeInTheDocument();
    expect(within(confirm).queryByRole("button", { name: /במקום/ })).not.toBeInTheDocument();
  });

  it("disables delete with its reason when a loan uses the category", async () => {
    const sheet = await openSheet("ביטוח נכס");
    const remove = within(sheet).getByRole("button", { name: /מחיקה/ });
    expect(remove).toBeDisabled();
    expect(within(sheet).getByText("הלוואה משתמשת בקטגוריה. העבירו קודם את התנועות.")).toBeInTheDocument();
  });

  it("switches rehab off with set_category_rehab", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("switch", { name: "נספרת בשיפוץ" }));
    await waitFor(() => { expect(calls("set_category_rehab")).toEqual([{ p_category_id: "c1", p_rehab: false }]); });
    expect(await screen.findByText("חומרים · לא נספרת בשיפוץ")).toBeInTheDocument();
    // The sheet stays open and follows the refetched row.
    await waitFor(() => { expect(within(sheet).getByRole("switch", { name: "נספרת בשיפוץ" })).not.toBeChecked(); });
    // The open sheet hides the rest of the page from the accessibility tree, toast included.
    fireEvent.click(screen.getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => { expect(calls("set_category_rehab")).toEqual([{ p_category_id: "c1", p_rehab: false }, { p_category_id: "c1", p_rehab: null }]); });
    await waitFor(() => { expect(within(sheet).getByRole("switch", { name: "נספרת בשיפוץ" })).toBeChecked(); });
  });

  it("has no rehab switch on an income category", async () => {
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("radio", { name: "הכנסות" }));
    fireEvent.click(await screen.findByRole("button", { name: "עוד, תקבול" }));
    const sheet = await screen.findByRole("dialog", { name: "תקבול" });
    expect(within(sheet).queryByRole("switch", { name: "נספרת בשיפוץ" })).not.toBeInTheDocument();
  });
});

describe("category sheet: rename", () => {
  it("puts שינוי שם after the P&L row and before the move row", async () => {
    const sheet = await openSheet("חומרים");
    const names = within(sheet).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const rename = names.findIndex((name) => name.includes("שינוי שם"));
    const move = names.findIndex((name) => name.includes("העברה לקטגוריה אחרת"));
    expect(rename).toBeGreaterThan(-1);
    expect(rename).toBeLessThan(move);
  });

  it("saves a trimmed name, then ביטול writes the old one back", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "שינוי שם" }));
    const form = await screen.findByRole("dialog", { name: "שינוי שם" });
    const field = within(form).getByLabelText("שם הקטגוריה");
    expect(field).toHaveValue("חומרים");
    fireEvent.change(field, { target: { value: "  חומרי בניין " } });
    fireEvent.click(within(form).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(calls("rename_category")).toEqual([{ p_category_id: "c1", p_name: "חומרי בניין" }]); });
    expect(await screen.findByText("השם נשמר")).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "שינוי שם" })).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => { expect(calls("rename_category")).toHaveLength(2); });
    expect(calls("rename_category")[1]).toEqual({ p_category_id: "c1", p_name: "חומרים" });
  });

  it("refuses a short name without a write and keeps the sheet on a taken name", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "שינוי שם" }));
    const form = await screen.findByRole("dialog", { name: "שינוי שם" });
    const field = within(form).getByLabelText("שם הקטגוריה");
    fireEvent.change(field, { target: { value: "א" } });
    fireEvent.click(within(form).getByRole("button", { name: "שמירה" }));
    expect(await within(form).findByText("שם קצר מדי – לפחות 2 תווים")).toBeInTheDocument();
    expect(calls("rename_category")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "קבלנים" } });
    fireEvent.click(within(form).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("יש כבר קטגוריה בשם הזה.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "שינוי שם" })).toBeInTheDocument();
  });

  it("closes without a write when the name is unchanged", async () => {
    const sheet = await openSheet("חומרים");
    fireEvent.click(within(sheet).getByRole("button", { name: "שינוי שם" }));
    const form = await screen.findByRole("dialog", { name: "שינוי שם" });
    fireEvent.click(within(form).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "שינוי שם" })).toBeNull(); });
    expect(calls("rename_category")).toHaveLength(0);
  });
});
