import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ChangeAssignment } from "./change-sheet";
import { placeToast } from "./toast";

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

describe("ChangeAssignment on a matched loan payment (FLOW-114)", () => {
  it("offers no category row when the category is locked", async () => {
    render(
      <MemoryRouter>
        <ChangeAssignment
          host="overlay"
          open
          onOpenChange={() => undefined}
          contained
          start="summary"
          categoryLocked
          supplier="בנק לדוגמה"
          amount="₪6,200"
          direction="expense"
          projects={[{ id: "p1", name: "פרויקט א" }]}
          categories={fewCategories}
          projectId=""
          categoryId="c1"
          onProjectId={() => undefined}
          onCategoryId={() => undefined}
          hold="בחרו פרויקט."
          onCommitPick={() => Promise.resolve(undefined)}
          onSplit={() => undefined}
          onCreateProject={(name) => Promise.resolve({ id: "new", name })}
        />
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^פרויקט:/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^קטגוריה:/ })).not.toBeInTheDocument();
  });
});

/** FLOW-309: the category mark follows the line, and a real open starts with no search text. */
function SuggestHarness({ categorySuggested }: { categorySuggested: boolean }) {
  return (
    <MemoryRouter>
      <ChangeAssignment
        host="overlay"
        open
        onOpenChange={() => undefined}
        supplier="ספק דוגמה"
        amount="₪100"
        direction="expense"
        projects={[{ id: "p1", name: "פרויקט א" }]}
        categories={fewCategories}
        projectId="p1"
        categoryId="c1"
        suggestionCategoryId="c1"
        categorySuggested={categorySuggested}
        onProjectId={() => undefined}
        onCategoryId={() => undefined}
        onCommitPick={() => Promise.resolve(undefined)}
        onSplit={() => undefined}
        onCreateProject={(name) => Promise.resolve({ id: "new", name })}
      />
    </MemoryRouter>
  );
}

describe("ChangeAssignment follow-ups (FLOW-309)", () => {
  it("drops the category mark once the line owns its category", async () => {
    const view = render(<SuggestHarness categorySuggested />);
    const row = await screen.findByRole("button", { name: "קטגוריה: קטגוריה 1, שינוי" });
    expect(within(row).getByText("הצעה")).toBeInTheDocument();
    view.rerender(<SuggestHarness categorySuggested={false} />);
    await waitFor(() => {
      expect(within(screen.getByRole("button", { name: "קטגוריה: קטגוריה 1, שינוי" })).queryByText("הצעה")).not.toBeInTheDocument();
    });
  });

  it("opens the project picker with an empty search, also after text was typed", async () => {
    render(<DirectHarness />);
    fireEvent.click(screen.getByRole("button", { name: "שורת פרויקט" }));
    const search = await screen.findByLabelText("חיפוש פרויקט");
    expect(search).toHaveValue("");
    fireEvent.change(search, { target: { value: "גבעת" } });
    expect(screen.queryByRole("radio", { name: "בית הכרם" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "שורת פרויקט" }));
    expect(await screen.findByLabelText("חיפוש פרויקט")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "בית הכרם" })).toBeInTheDocument();
  });

  it("pads the project picker under a toast that would cover ✕", async () => {
    document.documentElement.style.setProperty("--safe-top", "20px");
    render(<PickerHarness categories={fewCategories} pick="project" />);
    const dialog = await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    const sheet = dialog.closest("[data-vaul-drawer]");
    if (!(sheet instanceof HTMLElement)) throw new Error("the picker is not a drawer");
    expect(sheet.classList.contains("ui-sheet-tall")).toBe(true);
    const surface = sheet.querySelector(".ui-sheet-surface");
    if (!(surface instanceof HTMLElement)) throw new Error("the picker has no surface");
    const close = within(dialog).getByRole("button", { name: "סגירה" });
    const box = (bottom: number, height: number): DOMRect => DOMRect.fromRect({ x: 0, y: bottom - height, width: 120, height });
    const host = document.createElement("div");
    const toast = document.createElement("div");
    toast.className = "ui-toast";
    host.appendChild(toast);
    document.body.appendChild(host);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    // Every other control measures zero and is skipped; only ✕ sits under the toast.
    sheet.getBoundingClientRect = () => box(456, 400);
    close.getBoundingClientRect = () => {
      const applied = Number.parseFloat(surface.dataset.toastPad ?? "") || 0;
      return box(129 + applied, 44);
    };
    toast.getBoundingClientRect = () => box(69, 69);
    try {
      placeToast(host);
      expect(host.style.top).toBe("28px");
      expect(surface.dataset.toastPad).toBe("20");
      expect(surface.style.getPropertyValue("--toast-pad")).toBe("20px");
    } finally {
      host.remove();
      document.documentElement.style.removeProperty("--safe-top");
    }
  });
});

describe("ChangeAssignment split by categories link (FLOW-325 §10)", () => {
  function SplitHarness({ onSplitCategory, busy = false }: {
    onSplitCategory?: (leave: (to: string) => void) => void;
    busy?: boolean;
  }) {
    return (
      <MemoryRouter initialEntries={["/review/change?item=r1&pick=project"]}>
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
                categoryId="c1"
                onProjectId={() => undefined}
                onCategoryId={() => undefined}
                onSplit={() => undefined}
                onCreateProject={(name) => Promise.resolve({ id: "new", name })}
                {...(onSplitCategory ? { onSplitCategory, splitCategoryBusy: busy } : {})}
              />
            )}
          />
          <Route path="/transactions/:id/split-category" element={<h1>עורך</h1>} />
          <Route path="/review" element={<h1>לאישור</h1>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("shows no link without a handler", async () => {
    render(<SplitHarness />);
    await screen.findByRole("dialog", { name: "בחירת פרויקט" });
    expect(screen.getByRole("button", { name: "פיצול בין פרויקטים" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "פיצול לפי קטגוריות" })).not.toBeInTheDocument();
  });

  it("hands the press a leave that opens the editor", async () => {
    const handler = vi.fn((leave: (to: string) => void) => {
      leave("/transactions/t1/split-category");
    });
    render(<SplitHarness onSplitCategory={handler} />);
    fireEvent.click(await screen.findByRole("button", { name: "פיצול לפי קטגוריות" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "עורך" })).toBeInTheDocument();
  });

  it("drops the leave when the sheet closes before the approve settles", async () => {
    let leave: ((to: string) => void) | null = null;
    render(<SplitHarness onSplitCategory={(next) => { leave = next; }} />);
    fireEvent.click(await screen.findByRole("button", { name: "פיצול לפי קטגוריות" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "בחירת פרויקט" })).not.toBeInTheDocument();
    });
    act(() => {
      leave?.("/transactions/t1/split-category");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("heading", { name: "עורך" })).not.toBeInTheDocument();
  });

  it("does nothing on a press while busy, and the rows wait", async () => {
    const handler = vi.fn();
    render(<SplitHarness onSplitCategory={handler} busy />);
    const link = await screen.findByRole("button", { name: "פיצול לפי קטגוריות" });
    expect(link).toHaveAttribute("aria-busy", "true");
    fireEvent.click(link);
    expect(handler).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "פרויקט" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "פרויקט חדש" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "פיצול בין פרויקטים" })).toBeDisabled();
  });
});
