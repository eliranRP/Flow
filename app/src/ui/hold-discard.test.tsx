import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LineSplitScreen, type LineSplitSample } from "../screens/line-split";
import { SAMPLE_EXPENSE_LINE, sampleSplitApi } from "../dev/line-split-sample";
import { BooksProvider } from "../use-books";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangeAssignment } from "./change-sheet";
import { ToastProvider } from "./toast";

const projects = [
  { id: "p1", name: "בית הספר אלון" },
  { id: "p2", name: "מחסן הנמל" },
];
const categories = [
  { id: "c1", name: "מלט" },
  { id: "c2", name: "שינוע" },
];

function SheetHarness({
  hold = "בחרו פרויקט וקטגוריה.",
  category = "c1",
  onCommitPick,
  onCloseCheck,
  onDiscard,
}: {
  hold?: string;
  category?: string;
  onCommitPick?: (kind: "project" | "category", id: string) => Promise<undefined | "left">;
  onCloseCheck?: () => Promise<void>;
  onDiscard?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [projectId, setProjectId] = useState("p1");
  const [categoryId, setCategoryId] = useState(category);
  const [reason, setReason] = useState(hold);
  return (
    <>
      <div role="dialog" aria-label="דמה">
        <button type="button" aria-label="סגירה" onClick={() => { document.body.dataset.decoy = "1"; }}>
          ✕
        </button>
      </div>
      <ChangeAssignment
          host="overlay"
          open={open}
          onOpenChange={setOpen}
          supplier="עגורני החוף בע״מ"
          amount="₪1,000"
          direction="expense"
          projects={projects}
          categories={categories}
          projectId={projectId}
          categoryId={categoryId}
          onProjectId={setProjectId}
          onCategoryId={setCategoryId}
          hold={reason}
          onDiscard={() => {
            setReason("");
            onDiscard?.();
          }}
          onCommitPick={onCommitPick}
          onCloseCheck={onCloseCheck ?? (() => {
            if (projectId === "" || categoryId === "") {
              setReason("בחרו פרויקט וקטגוריה.");
              return Promise.reject(new Error("incomplete"));
            }
            return Promise.resolve();
          })}
          onSplit={() => undefined}
          onCreateProject={(name) => Promise.resolve({ id: "new", name })}
        />
      {open ? null : (
        <button type="button" onClick={() => { setReason(hold); setOpen(true); }}>פתיחה</button>
      )}
    </>
  );
}

function closeSheet() {
  const dialog = screen.getAllByRole("dialog").find((node) => node.getAttribute("aria-label") !== "דמה");
  if (!dialog) throw new Error("sheet dialog missing");
  fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
}

function renderSheet(props: Parameters<typeof SheetHarness>[0] = {}) {
  document.body.dataset.decoy = "";
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SheetHarness {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("change sheet discard", () => {
  it("discards from ביטול השינוי through this sheet, not the first dialog", async () => {
    const onDiscard = vi.fn();
    renderSheet({ onDiscard });
    expect(await screen.findByRole("button", { name: "ביטול השינוי" })).toHaveClass("ui-text-link-quiet");
    const hold = document.querySelector(".ui-hold-line");
    if (!(hold instanceof HTMLElement)) throw new Error("hold line missing");
    expect(hold.getAttribute("role")).toBeNull();
    const status = hold.querySelector("[role='status']");
    expect(status).toHaveTextContent("בחרו פרויקט וקטגוריה.");
    expect(status).not.toHaveTextContent("ביטול השינוי");
    fireEvent.click(screen.getByRole("button", { name: "ביטול השינוי" }));
    await waitFor(() => {
      expect(onDiscard).toHaveBeenCalledOnce();
    });
    expect(document.body.dataset.decoy).not.toBe("1");
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
  });

  it("stays on the first dismiss and discards on the second", async () => {
    const onDiscard = vi.fn();
    renderSheet({ onDiscard, hold: "", category: "" });
    expect(await screen.findByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    closeSheet();
    expect(await screen.findByText("בחרו פרויקט וקטגוריה.")).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    closeSheet();
    await waitFor(() => {
      expect(onDiscard).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("heading", { name: "שינוי שיוך" })).not.toBeInTheDocument();
  });

  it("forgets a discard after the sheet opens again", async () => {
    const onDiscard = vi.fn();
    renderSheet({ onDiscard });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול השינוי" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "פתיחה" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    expect(await screen.findByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    closeSheet();
    expect(await screen.findByText("בחרו פרויקט וקטגוריה.")).toBeInTheDocument();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight save and then closes without discarding it", async () => {
    let finish: () => void = () => undefined;
    const onDiscard = vi.fn();
    const onCommitPick = vi.fn(() => new Promise<undefined>((resolve) => {
      finish = () => { resolve(undefined); };
    }));
    renderSheet({ onDiscard, onCommitPick, hold: "" });
    fireEvent.click(await screen.findByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "שינוע" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    closeSheet();
    expect(screen.getByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    await act(() => {
      finish();
      return Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
    });
    expect(onCommitPick).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

describe("split discard", () => {
  function renderSplit(onSave?: () => Promise<void>, rest: string | null = "p1", value = "250") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const line = { ...SAMPLE_EXPENSE_LINE, id: "t", amountNet: -100_000n, categoryId: "c1", categoryName: "מלט", projectId: "p1", projectName: "בית הספר אלון" };
    const sample: LineSplitSample = {
      line,
      categories: [{ id: "c1", name: "מלט", kind: "expense", hidden: false }],
      projects: [
        { id: "p1", name: "בית הספר אלון" },
        { id: "p2", name: "מחסן הנמל" },
      ],
      parts: [{ key: "p2", categoryId: "c1", projectId: "p2", unit: "amount", value }],
      rest: { categoryId: "c1", projectId: rest },
      api: sampleSplitApi(line, onSave),
    };
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/transactions/t/split-category"]}>
              <Routes>
                <Route path="/transactions/:transactionId/split-category" element={<LineSplitScreen sample={sample} />} />
                <Route path="/transactions/:transactionId" element={<h1>התור</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("discards an incomplete split from ביטול השינוי", async () => {
    renderSplit(undefined, "p1", "");
    fireEvent.click(await screen.findByRole("button", { name: "סגירה" }));
    const cancel = await screen.findByRole("button", { name: "ביטול השינוי" });
    expect(cancel).toHaveClass("ui-text-link-quiet");
    fireEvent.click(cancel);
    expect(await screen.findByRole("heading", { name: "התור" })).toBeInTheDocument();
  });

  it("waits for an in-flight save and then leaves", async () => {
    let finish: (() => void) | null = null;
    const onSave = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => { resolve(); };
    }));
    renderSplit(onSave);
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום, מלט" }), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "סכום, מלט" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "פיצול" })).toBeInTheDocument();
    await act(() => {
      finish?.();
      return Promise.resolve();
    });
    expect(await screen.findByRole("heading", { name: "התור" })).toBeInTheDocument();
  });
});
