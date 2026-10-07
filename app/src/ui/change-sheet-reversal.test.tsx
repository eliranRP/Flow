import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { isReversal, reversalChoices } from "../reversal";
import { ChangeAssignment } from "./change-sheet";

const expenseCategories = [
  { id: "e1", name: "חומרים" },
  { id: "e2", name: "הובלה" },
];
const incomeReversals = [
  { id: "i1", name: "שכירות" },
  { id: "i2", name: "דמי ניהול" },
];

function Harness({ start = "", reversals = incomeReversals, query }: { start?: string; reversals?: typeof incomeReversals; query?: string }) {
  const [categoryId, setCategoryId] = useState(start);
  return (
    <MemoryRouter initialEntries={["/?pick=category"]}>
      <ChangeAssignment
        host="overlay"
        open
        onOpenChange={() => undefined}
        supplier="ספק דוגמה"
        amount="−$1,200"
        direction="expense"
        projects={[{ id: "p1", name: "פרויקט א" }]}
        categories={expenseCategories}
        reversals={reversals}
        projectId="p1"
        categoryId={categoryId}
        onProjectId={() => undefined}
        onCategoryId={setCategoryId}
        onCommitPick={() => Promise.resolve(undefined)}
        onSplit={() => undefined}
        onCreateProject={(name) => Promise.resolve({ id: "new", name })}
        initialQuery={query}
      />
    </MemoryRouter>
  );
}

describe("reversal section in the category picker", () => {
  it("starts closed, opens on tap, and lists the other kind in its own radiogroup", async () => {
    render(<Harness />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    const toggle = within(dialog).getByRole("button", { name: "הכנסה שהוחזרה" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByRole("radio", { name: "שכירות" })).not.toBeInTheDocument();
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    const group = within(dialog).getByRole("radiogroup", { name: "הכנסה שהוחזרה" });
    expect(group).toHaveAccessibleDescription("למשל שכירות שחזרה. מקטין את ההכנסות.");
    expect(within(group).getByRole("radio", { name: "שכירות" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "קטגוריה" })).not.toContainElement(within(group).getByRole("radio", { name: "שכירות" }));
  });

  it("stays open with a heading when the current category is a reversal", async () => {
    render(<Harness start="i1" />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(within(dialog).queryByRole("button", { name: "הכנסה שהוחזרה" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("הכנסה שהוחזרה")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "שכירות" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a search match from the other kind under its heading", async () => {
    render(<Harness query="שכיר" />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(within(dialog).getByRole("radiogroup", { name: "הכנסה שהוחזרה" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "שכירות" })).toBeInTheDocument();
    expect(within(dialog).queryByText("לא נמצאה קטגוריה בשם הזה")).not.toBeInTheDocument();
  });

  it("shows no section when the other kind has nothing to offer", async () => {
    render(<Harness reversals={[]} />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(within(dialog).queryByText("הכנסה שהוחזרה")).not.toBeInTheDocument();
  });
});

describe("reversal helpers", () => {
  const rows = [
    { id: "e1", name: "חומרים", kind: "expense", hidden: false },
    { id: "e2", name: "ריבית", kind: "expense", hidden: false, loan_part: "interest" },
    { id: "i1", name: "שכירות", kind: "income", hidden: false },
    { id: "i2", name: "ישנה", kind: "income", hidden: true },
    { id: "i3", name: "העברות", kind: "income", hidden: false, excluded_from_pnl: true },
  ];

  it("offers the other kind without hidden, loan or kept-out categories", () => {
    expect(reversalChoices(rows, "expense")).toEqual([{ id: "i1", name: "שכירות" }]);
    expect(reversalChoices(rows, "income")).toEqual([{ id: "e1", name: "חומרים" }]);
  });

  it("marks a line whose category is of the other kind", () => {
    expect(isReversal(rows, "i1", "expense")).toBe(true);
    expect(isReversal(rows, "e1", "expense")).toBe(false);
    expect(isReversal(rows, "e1", "income")).toBe(true);
    expect(isReversal(rows, "missing", "expense")).toBe(false);
    expect(isReversal(rows, null, "expense")).toBe(false);
  });
});
