import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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

/** FLOW-320: a row opens its own picker in a contained overlay, like the transaction detail. */
function DirectHarness({
  onCommitPick = () => Promise.resolve(undefined),
  hold,
}: {
  onCommitPick?: (kind: "project" | "category", id: string) => Promise<undefined | "left" | "hold">;
  hold?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<"project" | "category">("project");
  const [projectId, setProjectId] = useState("p1");
  const [categoryId, setCategoryId] = useState("c1");
  const projectRow = useRef<HTMLButtonElement>(null);
  const categoryRow = useRef<HTMLButtonElement>(null);
  return (
    <MemoryRouter>
      <button ref={projectRow} type="button" onClick={() => { setStart("project"); setOpen(true); }}>שורת פרויקט</button>
      <button ref={categoryRow} type="button" onClick={() => { setStart("category"); setOpen(true); }}>שורת קטגוריה</button>
      <ChangeAssignment
        host="overlay"
        open={open}
        onOpenChange={setOpen}
        contained
        start={start}
        returnFocusRef={start === "category" ? categoryRow : projectRow}
        supplier="נגריית הגליל"
        amount="₪100"
        direction="expense"
        projects={[{ id: "p1", name: "בית הכרם" }, { id: "p2", name: "גבעת אורנים" }]}
        categories={fewCategories}
        projectId={projectId}
        categoryId={categoryId}
        onProjectId={setProjectId}
        onCategoryId={setCategoryId}
        hold={hold}
        onCommitPick={onCommitPick}
        onSplit={() => undefined}
        onCreateProject={(name) => Promise.resolve({ id: "new", name })}
      />
    </MemoryRouter>
  );
}

describe("ChangeAssignment opened on a picker", () => {
  it("opens each row on its own picker, with no summary on the way", async () => {
    render(<DirectHarness />);
    fireEvent.click(screen.getByRole("button", { name: "שורת קטגוריה" }));
    expect(screen.getByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "שורת פרויקט" }));
    expect(screen.getByRole("heading", { name: "בחירת פרויקט" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
  });

  it("closes on חזרה and returns focus to the row", async () => {
    render(<DirectHarness />);
    const row = screen.getByRole("button", { name: "שורת קטגוריה" });
    row.focus();
    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "בחירת קטגוריה" })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(row).toHaveFocus();
    }, { timeout: 2000 });
  });

  it("closes on Escape and returns focus to the row", async () => {
    render(<DirectHarness />);
    const row = screen.getByRole("button", { name: "שורת פרויקט" });
    row.focus();
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(row).toHaveFocus();
    }, { timeout: 2000 });
  });

  it("closes after a pick, so a re-file is two taps", async () => {
    const onCommitPick = vi.fn(() => Promise.resolve(undefined));
    render(<DirectHarness onCommitPick={onCommitPick} />);
    fireEvent.click(screen.getByRole("button", { name: "שורת קטגוריה" }));
    fireEvent.click(await screen.findByRole("radio", { name: "קטגוריה 3" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onCommitPick).toHaveBeenCalledWith("category", "c3");
  });

  it("shows the summary on a hold, and a picker from there returns to it", async () => {
    render(<DirectHarness hold="בחרו פרויקט וקטגוריה." onCommitPick={() => Promise.resolve("hold" as const)} />);
    fireEvent.click(screen.getByRole("button", { name: "שורת פרויקט" }));
    fireEvent.click(await screen.findByRole("radio", { name: "גבעת אורנים" }));
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByText("בחרו פרויקט וקטגוריה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /קטגוריה:/ }));
    expect(await screen.findByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(await screen.findByRole("heading", { name: "שינוי שיוך" })).toBeInTheDocument();
  });
});
