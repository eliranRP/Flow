import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SplitScreen } from "../screens/flow-screens";
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
  onCommitPick?: (kind: "project" | "category", id: string) => Promise<void | "left">;
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
          onCloseCheck={onCloseCheck ?? (async () => {
            if (projectId === "" || categoryId === "") {
              setReason("בחרו פרויקט וקטגוריה.");
              throw new Error("incomplete");
            }
          })}
          onSplit={() => undefined}
          onCreateProject={async (name) => ({ id: "new", name })}
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
    const onCommitPick = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    renderSheet({ onDiscard, onCommitPick, hold: "" });
    fireEvent.click(await screen.findByRole("button", { name: /קטגוריה:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "שינוע" }));
    closeSheet();
    expect(screen.getByRole("heading", { name: "בחירת קטגוריה" })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "בחירת קטגוריה" })).not.toBeInTheDocument();
    });
    expect(onCommitPick).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

describe("split discard", () => {
  function renderSplit(onSave?: () => Promise<void | boolean>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter initialEntries={["/split"]}>
              <Routes>
                <Route
                  path="/split"
                  element={
                    <SplitScreen
                      sampleAmount={100_000n}
                      sampleProjects={[
                        { id: "p1", name: "בית הספר אלון", incomeAgorot: 1n },
                        { id: "p2", name: "מחסן הנמל", incomeAgorot: 1n },
                      ]}
                      backTo="/review"
                      onSave={onSave}
                    />
                  }
                />
                <Route path="/review" element={<h1>התור</h1>} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("discards an incomplete split from ביטול השינוי", async () => {
    renderSplit();
    fireEvent.click(await screen.findByRole("radio", { name: "שווה בין פרויקטים שאבחר" }));
    const cancel = await screen.findByRole("button", { name: "ביטול השינוי" });
    expect(cancel).toHaveClass("ui-text-link-quiet");
    expect(screen.getByText("בחרו לפחות 2 פרויקטים")).toHaveClass("t-hint");
    fireEvent.click(cancel);
    expect(await screen.findByRole("heading", { name: "התור" })).toBeInTheDocument();
  });

  it("waits for an in-flight save and then leaves", async () => {
    let finish: (() => void) | null = null;
    const onSave = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    renderSplit(onSave);
    fireEvent.click(await screen.findByRole("radio", { name: "שווה בין כל הפרויקטים" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onSave).toHaveBeenCalledOnce();
    const others = [
      screen.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }),
      screen.getByRole("radio", { name: "לפי הכנסות" }),
      screen.getByRole("radio", { name: "לפרויקט אחד" }),
    ];
    for (const row of others) {
      expect(row).toBeDisabled();
      expect(row).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("radio", { name: "שווה בין כל הפרויקטים" })).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.getByRole("heading", { name: "איך לחלק?" })).toBeInTheDocument();
    await act(async () => {
      finish?.();
    });
    expect(await screen.findByRole("heading", { name: "התור" })).toBeInTheDocument();
  });
});
