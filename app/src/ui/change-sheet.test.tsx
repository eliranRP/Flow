import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ChangeAssignment } from "./change-sheet";

const fewCategories = Array.from({ length: 8 }, (_, index) => ({
  id: `c${String(index + 1)}`,
  name: `קטגוריה ${String(index + 1)}`,
}));

const manyCategories = Array.from({ length: 9 }, (_, index) => ({
  id: `c${String(index + 1)}`,
  name: `קטגוריה ${String(index + 1)}`,
}));

function PickerHarness({ categories, pick }: { categories: typeof fewCategories; pick: "project" | "category" }) {
  const [open, setOpen] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  return (
    <MemoryRouter initialEntries={[`/?pick=${pick}`]}>
      <ChangeAssignment
        host="overlay"
        open={open}
        onOpenChange={setOpen}
        supplier="ספק דוגמה"
        amount="₪100"
        direction="expense"
        projects={[{ id: "p1", name: "פרויקט א" }]}
        categories={categories}
        projectId={projectId}
        categoryId={categoryId}
        onProjectId={setProjectId}
        onCategoryId={setCategoryId}
        onCommitPick={() => Promise.resolve(undefined)}
        onSplit={() => undefined}
        onCreateProject={(name) => Promise.resolve({ id: "new", name })}
      />
    </MemoryRouter>
  );
}

describe("ChangeAssignment picker", () => {
  it("uses a fit panel for categories, hides search for eight, and keeps projects tall", async () => {
    const first = render(<PickerHarness categories={fewCategories} pick="category" />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(dialog.closest(".ui-sheet-fit")).not.toBeNull();
    expect(within(dialog).queryByLabelText("חיפוש קטגוריה")).not.toBeInTheDocument();
    first.unmount();

    const second = render(<PickerHarness categories={manyCategories} pick="category" />);
    const withSearch = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(within(withSearch).getByLabelText("חיפוש קטגוריה")).toBeInTheDocument();
    second.unmount();

    render(<PickerHarness categories={fewCategories} pick="project" />);
    const projectDialog = await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    expect(projectDialog.closest(".ui-sheet-tall")).not.toBeNull();
  });

  it("closes a line picker with סגירה only", async () => {
    render(
      <MemoryRouter initialEntries={["/review/change?item=r1&from=line&pick=category"]}>
        <Routes>
          <Route
            path="/review/change"
            element={(
              <ChangeAssignment
                host="route"
                closeTo="/review"
                supplier="ספק"
                amount="₪1"
                direction="expense"
                projects={[{ id: "p1", name: "פרויקט" }]}
                categories={fewCategories}
                projectId="p1"
                categoryId=""
                onProjectId={() => undefined}
                onCategoryId={() => undefined}
                onCommitPick={() => Promise.resolve(undefined)}
                onSplit={() => undefined}
                onCreateProject={(name) => Promise.resolve({ id: "n", name })}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole("dialog", { name: "בחירת קטגוריה" });
    expect(within(dialog).queryByRole("button", { name: "חזרה" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
  });
});
