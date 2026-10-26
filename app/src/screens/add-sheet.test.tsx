import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AddForm } from "./add-sheet";
import { type BankMatch, datePresets, emptyDraft, type EntryDraft } from "../add-entry";
import { AddEntryView, type AddEntryViewProps } from "./add-entry-view";
import { readFileSync } from "node:fs";
import path from "node:path";

// --- add-sheet.test.tsx

// FLOW-331 r1: Back after a quick action.
function Landed() {
  const location = useLocation();
  return <p>{`landed ${location.pathname}${location.search}`}</p>;
}

function renderAdd() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/add?preview=1"]}>
        <Routes>
          <Route path="/add" element={<AddForm />} />
          <Route path="/settings/connections" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddForm rows", () => {
  it("offers no bank row to anyone: connecting a bank stays in Settings", async () => {
    renderAdd();
    expect(await screen.findByRole("button", { name: /פרויקט חדש/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /הלוואה חדשה/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /חיבור בנק/ })).toBeNull();
  });

  it("draws the rows as text and a chevron, with no icon", async () => {
    renderAdd();
    const row = await screen.findByRole("button", { name: /הלוואה חדשה/ });
    expect(row.querySelector(".ui-row-icon")).toBeNull();
  });
});

describe("+ quick action history", () => {
  // Real browser history: a sheet's Back layer pops only with a browser index (MemoryRouter drops it in place).
  function renderBrowser(start: string) {
    window.history.replaceState(null, "", start);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>,
    );
  }

  async function quickAction(name: RegExp) {
    fireEvent.click(await screen.findByRole("link", { name: "הוספה" }));
    fireEvent.click(await screen.findByRole("button", { name }));
  }

  it("Back after + → פרויקט חדש closes the sheet, then leaves Projects for the screen before +", async () => {
    const view = renderBrowser("/?preview=1");
    await quickAction(/פרויקט חדש/);
    expect(await screen.findByRole("dialog", { name: "פרויקט חדש" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט חדש" })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/projects");
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(window.location.pathname).toBe("/"); });
    expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("Back after + → הלוואה חדשה closes the loan sheet and keeps Loans", async () => {
    const view = renderBrowser("/?preview=1");
    await quickAction(/הלוואה חדשה/);
    expect(await screen.findByRole("dialog", { name: /הלוואה/ })).toBeInTheDocument();
    expect(window.location.search).not.toContain("new=");
    window.history.back();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: /הלוואה/ })).not.toBeInTheDocument(); });
    expect(window.location.pathname).toBe("/loans");
    view.unmount();
    window.history.replaceState(null, "", "/");
  });
});
// --- add-entry-view.test.tsx

const TODAY = "16/10/2026";
const projects = [{ id: "p1", name: "Fernbrook Ln" }];
const categories = [{ id: "c1", name: "ציוד", kind: "expense" as const }];

function setup(overrides: Partial<AddEntryViewProps> = {}, draft: Partial<EntryDraft> = {}) {
  const props: AddEntryViewProps = {
    kind: "cash",
    projects,
    categories,
    edit: { ...emptyDraft(null, TODAY), ...draft },
    onDraftChange: vi.fn(),
    formatMoney: (minor) => (minor / 100).toFixed(2),
    onClose: vi.fn(),
    onSave: vi.fn(),
    onAddProject: vi.fn(() => Promise.resolve("p2")),
    onAddCategory: vi.fn(() => Promise.resolve("c2")),
    ...overrides,
  };
  return { ...render(<AddEntryView {...props} />), props };
}

const complete = { amount: "12.50", payee: "Ajax Hardware", projectId: "p1", categoryId: "c1" };

describe("AddEntryView save rule (FLOW-966: never disabled)", () => {
  it("is never disabled: a tap with something missing marks each field, says what it needs and focuses the first", () => {
    const { props } = setup({}, { ...complete, amount: "", projectId: null, categoryId: null });
    const save = screen.getByRole("button", { name: "שמירת ההוצאה" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(props.onSave).not.toHaveBeenCalled();
    const amount = screen.getByRole("textbox", { name: "סכום" });
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("חסר סכום");
    expect(amount).toHaveFocus();
    expect(screen.getByRole("radiogroup", { name: "פרויקט" })).toHaveAccessibleDescription("בחרו פרויקט, או \"בלי פרויקט\"");
    expect(screen.getByRole("radiogroup", { name: "קטגוריה" })).toHaveAccessibleDescription("בחרו קטגוריה");
    expect(screen.getByRole("textbox", { name: "למי" })).toHaveAttribute("aria-invalid", "false");
  });

  it("shows no error before the first tap, and names what it saves", () => {
    setup({}, { ...complete, direction: "in", categoryId: null });
    expect(screen.queryByText("בחרו קטגוריה")).toBeNull();
    expect(screen.getByRole("button", { name: "שמירת ההכנסה" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ממי" })).toHaveAttribute("dir", "auto");
  });

  it("calls onSave with the draft once everything is set", () => {
    const { props } = setup({}, complete);
    fireEvent.click(screen.getByRole("button", { name: "שמירת ההוצאה" }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: "12.50", projectId: "p1" }));
  });

  it("offers today and yesterday as quick date picks", () => {
    const { props } = setup({}, complete);
    const today = screen.getByRole("button", { name: "היום" });
    expect(today).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "אתמול" }));
    const yesterday = datePresets()[1]?.[0];
    expect(props.onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ date: yesterday }));
  });

  it("puts the project and category chips in radiogroups", () => {
    setup({}, complete);
    expect(screen.getByRole("radio", { name: "Fernbrook Ln" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "בלי פרויקט" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("AddEntryView inline new project", () => {
  it("keeps הוספה off for a name that already exists", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ פרויקט חדש" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט החדש" }), { target: { value: "Fernbrook Ln" } });
    expect(screen.getByRole("button", { name: "הוספה" })).toBeDisabled();
    expect(screen.getByText("כבר יש פרויקט בשם הזה")).toBeInTheDocument();
  });

  it("adds the project and picks it", async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ פרויקט חדש" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט החדש" }), { target: { value: "Willow Dr" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספה" }));
    expect(props.onAddProject).toHaveBeenCalledWith("Willow Dr");
    await vi.waitFor(() => { expect(props.onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p2" })); });
  });

  it("is not offered when the form opened from a project", () => {
    setup({ fromProject: "Fernbrook Ln" });
    expect(screen.queryByRole("button", { name: "+ פרויקט חדש" })).not.toBeInTheDocument();
  });
});

describe("AddEntryView receipt match", () => {
  const match: BankMatch = { id: "t1", description: "Ajax Hardware", doc_date: "2026-10-10", amount_minor: 1250, source: "SUMIT" };

  it("says the receipt attaches to the bank line and the save names it", () => {
    setup({ kind: "receipt", match, document: { name: "receipt.jpg", mime: "image/jpeg", bytes: 1000, sha256: "a".repeat(64) } }, complete);
    expect(screen.getByText("נמצאה תנועה בבנק")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה וצירוף לתנועה" })).toBeEnabled();
  });
});
// --- add-entry-css.test.ts

// FLOW-919: the form's sheet edge and head rule are scoped to the form (the shared sheet keeps its defaults).
const css = readFileSync(path.resolve(__dirname, "../ui/css/44-add-entry.css"), "utf8");

describe("add form sheet edge (FLOW-919)", () => {
  it("sets the form panel's top edge to 54px, with the keyboard rule kept", () => {
    expect(css).toMatch(/\.ui-add-entry \{\s*--sheet-gap: 54px;/);
    expect(css).toMatch(/:root\[data-kb="open"\] \.ui-add-entry/);
  });

  it("draws the form head's rule in the hairline colour", () => {
    expect(css).toMatch(/\.ui-add-entry \.ui-sheet-head \{[^}]*border-block-end: 1px solid var\(--color-line\)/);
  });
});