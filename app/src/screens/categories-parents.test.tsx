import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { deleteFailureText, mergeFailureText } from "../category-copy";
import { groupFailureText } from "./category-group";
import { CategoriesScreen, topLevelCategories } from "./categories-screen";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
}));

const ROWS = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, lines: 42 },
  { id: "c2", name: "תחזוקה", kind: "expense", hidden: false, is_default: false, lines: 0, rollup_lines: 48, children_count: 3, parent_id: null },
  { id: "c3", name: "חשמל", kind: "expense", hidden: false, is_default: false, parent_id: "c2" },
  { id: "c4", name: "אינסטלציה", kind: "expense", hidden: false, is_default: false, parent_id: "c2" },
  { id: "c5", name: "ניקיון", kind: "expense", hidden: true, is_default: false, parent_id: "c2" },
];

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "list_categories") return Promise.resolve({ data: ROWS, error: null });
      return Promise.resolve({ data: "new-id", error: null });
    },
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  }),
}));

function renderAt(entry: string, node: ReactNode = <CategoriesScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/settings/categories" element={node} />
              <Route path="/settings/categories/:parentId" element={node} />
              <Route path="/search" element={<p>search</p>} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const sample = ROWS.map((row) => ({ ...row, kind: row.kind as "expense" }));

describe("FLOW-406 sub-categories in Settings → Categories", () => {
  it("lists only top-level categories; a sub-category of a hidden parent joins them", () => {
    expect(topLevelCategories(sample).map((row) => row.id)).toEqual(["c1", "c2"]);
    const hiddenParent = sample.map((row) => (row.id === "c2" ? { ...row, hidden: true } : row));
    expect(topLevelCategories(hiddenParent).map((row) => row.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("shows a parent with its roll-up line count in the one count column and opens its page", async () => {
    renderAt("/settings/categories", <CategoriesScreen sample={sample} />);
    expect(screen.queryByText("חשמל")).not.toBeInTheDocument();
    const parent = screen.getByRole("link", { name: /תחזוקה/ });
    // FLOW-356: the same unit as the other rows, its own lines and its sub-categories'.
    expect(parent).toHaveTextContent("48 תנועות");
    expect(parent).not.toHaveTextContent("תת־קטגוריות");
    expect(screen.getByRole("link", { name: /חומרים/ })).toHaveTextContent("42 תנועות");
    fireEvent.click(parent);
    expect(await screen.findByRole("heading", { name: "תחזוקה" })).toBeInTheDocument();
    expect(screen.getByText("48 תנועות")).toBeInTheDocument();
    expect(screen.getByText("חשמל")).toBeInTheDocument();
    expect(screen.getByText("אינסטלציה")).toBeInTheDocument();
    // The hidden sub-category waits behind מוסתרות, and there is no kind switch on a parent's page.
    expect(screen.queryByText("ניקיון")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "סוג" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מוסתרות/ })).toBeInTheDocument();
  });

  it("adds a sub-category under the parent", async () => {
    rpc.calls.length = 0;
    renderAt("/settings/categories/c2");
    fireEvent.click(await screen.findByRole("button", { name: "הוספת תת־קטגוריה" }));
    const sheet = await screen.findByRole("dialog", { name: "תת־קטגוריה חדשה" });
    fireEvent.change(within(sheet).getByLabelText("שם"), { target: { value: "גינון" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc.calls.find((call) => call.name === "create_category")?.args).toEqual({ p_name: "גינון", p_kind: "expense", p_parent_id: "c2" });
    });
  });

  it("goes back to the list when the parent is gone, or the id is a sub-category's", async () => {
    renderAt("/settings/categories/nope");
    expect(await screen.findByRole("heading", { name: "קטגוריות" })).toBeInTheDocument();
  });

  it("sends a sub-category's id back to the list", async () => {
    renderAt("/settings/categories/c3");
    expect(await screen.findByRole("heading", { name: "קטגוריות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "חשמל" })).not.toBeInTheDocument();
  });

  it("keeps הכנסות in the URL, so Back from an income parent lands there", () => {
    const income = [
      { id: "i1", name: "שכירות", kind: "income" as const, hidden: false, is_default: false },
      { id: "i2", name: "דירה 1", kind: "income" as const, hidden: false, is_default: false, parent_id: "i1" },
    ];
    renderAt("/settings/categories", <CategoriesScreen sample={income} />);
    fireEvent.click(screen.getByRole("radio", { name: "הכנסות" }));
    expect(screen.getByRole("link", { name: /שכירות/ })).toHaveAttribute("href", "/settings/categories/i1");
    fireEvent.click(screen.getByRole("link", { name: /שכירות/ }));
    expect(screen.getByRole("heading", { name: "שכירות" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חזרה|קטגוריות/ }));
    expect(screen.getByRole("radio", { name: "הכנסות" })).toBeChecked();
    expect(screen.getByRole("link", { name: /שכירות/ })).toBeInTheDocument();
  });

  it("says why a parent cannot be deleted, merged or put in a group", () => {
    const children = new Error("category_has_children");
    expect(deleteFailureText(children)).toBe("יש לקטגוריה תת־קטגוריות. העבירו אותן קודם.");
    expect(mergeFailureText(children)).toBe("יש לקטגוריה תת־קטגוריות. העבירו אותן קודם.");
    expect(groupFailureText(Object.assign(new Error("category_parent_nested"), { code: "23514" })))
      .toBe("לקטגוריה הזו יש תת־קטגוריות, אז אין לה קטגוריית אב.");
  });
});
