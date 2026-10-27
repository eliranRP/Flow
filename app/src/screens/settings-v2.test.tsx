import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CategoryRow } from "@flow/shared";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { toastMs } from "../ui/toast-layout";
import { ToastProvider } from "../ui/toast";
import { topToast } from "../ui/top-toast";
import { BooksProvider } from "../use-books";
import { useWrite } from "../use-write";
import { NEW_CATEGORY_EMPTY, NEW_CATEGORY_TAKEN, newCategoryProblem } from "./categories-screen";
import { CategoriesScreen, SettingsScreen } from "./flow-screens";
import { SETTINGS_OFFLINE } from "./settings-offline";

// FLOW-972 (Settings v2, decision 0222): toasts under the header (ביטול 5s, a note 4s), the offline line,
// and the new-category note that replaces a greyed-out button.

function providers(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const rows = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, parent_id: null },
  { id: "c2", name: "שכר דירה", kind: "income", hidden: false, parent_id: null },
] as unknown as CategoryRow[];

describe("topToast", () => {
  it("puts a toast under the header, ביטול 5s and a note 4s", () => {
    const undo = topToast({ message: "השם נשמר", action: "ביטול", onAction: () => undefined });
    const note = topToast({ message: "הקטגוריה נשמרה" });
    expect(undo.place).toBe("top");
    expect(note.place).toBe("top");
    expect(toastMs(undo)).toBe(5000);
    expect(toastMs(note)).toBe(4000);
  });
});

function SuccessWrite() {
  const write = useWrite({ place: "top", keys: [], success: "נשמר", failure: "לא נשמר", run: () => Promise.resolve() });
  return <button type="button" onClick={() => { write.mutate(); }}>כתיבה</button>;
}

describe("a write's note under the header", () => {
  it("shows its success note under the header", async () => {
    render(providers(<SuccessWrite />));
    fireEvent.click(screen.getByRole("button", { name: "כתיבה" }));
    expect(await screen.findByText("נשמר")).toBeInTheDocument();
    await waitFor(() => { expect(document.querySelector('[data-place="top"]')).not.toBeNull(); });
  });
});

describe("newCategoryProblem", () => {
  it("says nothing for a new name, and names a taken one as it is typed", () => {
    expect(newCategoryProblem("ציוד", rows, "expense", false)).toBeUndefined();
    expect(newCategoryProblem(" חומרים ", rows, "expense", false)).toBe(NEW_CATEGORY_TAKEN);
  });

  it("checks the name within the kind only", () => {
    expect(newCategoryProblem("שכר דירה", rows, "expense", true)).toBeUndefined();
    expect(newCategoryProblem("שכר דירה", rows, "income", true)).toBe(NEW_CATEGORY_TAKEN);
  });

  it("names an empty name only after the tap", () => {
    expect(newCategoryProblem("  ", rows, "expense", false)).toBeUndefined();
    expect(newCategoryProblem("  ", rows, "expense", true)).toBe(NEW_CATEGORY_EMPTY);
  });
});

describe("the new-category sheet", () => {
  it("keeps יצירת הקטגוריה enabled and says what is missing on the tap", async () => {
    render(providers(<CategoriesScreen sample={rows} />));
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה חדשה" }));
    const create = await screen.findByRole("button", { name: "יצירת הקטגוריה" });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(await screen.findByText(NEW_CATEGORY_EMPTY)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "שם" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "שם" }), { target: { value: "חומרים" } });
    expect(screen.getByText(NEW_CATEGORY_TAKEN)).toBeInTheDocument();
  });
});

describe("offline", () => {
  afterEach(() => { act(() => { onlineManager.setOnline(true); }); });

  it("says on a settings page that changes wait for the connection", () => {
    render(providers(<SettingsScreen sample={{ name: "אלפא בנייה", connected: false, companyId: 1, lastError: null }} />));
    expect(screen.queryByText(new RegExp(SETTINGS_OFFLINE))).not.toBeInTheDocument();
    act(() => { onlineManager.setOnline(false); });
    const line = document.querySelector(".ui-page-offline");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.textContent).toContain(`אין חיבור · ${SETTINGS_OFFLINE}`);
    expect(screen.getByText("מתחבר מחדש…")).toBeInTheDocument();
  });
});
