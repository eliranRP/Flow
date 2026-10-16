// FLOW-369: the add form's container. A matched receipt attaches to its bank line and adds no line;
// a new project is added, picked and says so in a toast.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachedDocument, BankMatch } from "../add-entry";
import { ToastProvider } from "../ui/toast";
import { AddEntrySheet } from "./add-entry-sheet";

const match: BankMatch = { id: "t1", description: "Ajax Hardware", doc_date: "2026-10-10", amount_minor: 40901, source: "SUMIT" };
const document: AttachedDocument = { name: "ajax-receipt.jpg", mime: "image/jpeg", bytes: 183000, sha256: "b".repeat(64) };

const mocks = vi.hoisted(() => ({
  saveManualLine: vi.fn(() => Promise.resolve("new-line")),
  attachDocument: vi.fn(() => Promise.resolve()),
  undoAttach: vi.fn(() => Promise.resolve()),
  undoManualLine: vi.fn(() => Promise.resolve()),
  createProjectNamed: vi.fn(() => Promise.resolve("p3")),
  createCategoryNamed: vi.fn(() => Promise.resolve("c4")),
  match: null as BankMatch | null,
}));

vi.mock("../use-add-entry", () => ({
  saveManualLine: mocks.saveManualLine,
  attachDocument: mocks.attachDocument,
  undoAttach: mocks.undoAttach,
  undoManualLine: mocks.undoManualLine,
  createProjectNamed: mocks.createProjectNamed,
  createCategoryNamed: mocks.createCategoryNamed,
  useReceiptMatch: () => ({ data: mocks.match }),
}));

vi.mock("../preview", () => ({ useHomePreview: () => "off" }));

vi.mock("../use-books", () => ({
  useDashboardQuery: () => ({
    data: { projects: [{ id: "p1", name: "Oak Ridge", status: "active" }] },
  }),
  useCategoriesQuery: () => ({
    data: [{ id: "c1", name: "ציוד", kind: "expense", hidden: false, loan_part: null }],
  }),
  useInvalidateBooks: () => () => Promise.resolve(),
}));

function renderSheet(props: Partial<Parameters<typeof AddEntrySheet>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AddEntrySheet kind="cash" onDone={onDone} onClose={onClose} {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onDone, onClose };
}

function fillCash() {
  fireEvent.change(screen.getByRole("textbox", { name: "למי" }), { target: { value: "Ajax Hardware" } });
  fireEvent.change(screen.getByLabelText(/סכום/), { target: { value: "409.01" } });
  fireEvent.click(screen.getByRole("button", { name: "Oak Ridge" }));
  fireEvent.click(screen.getByRole("button", { name: "ציוד" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.match = null;
});

describe("AddEntrySheet receipt match", () => {
  it("attaches the receipt to the matched bank line and adds no line", async () => {
    mocks.match = match;
    const { onDone } = renderSheet({ kind: "receipt", initialDocument: document });
    fillCash();
    fireEvent.click(await screen.findByRole("button", { name: "שמירה וצירוף לתנועה" }));
    await waitFor(() => { expect(onDone).toHaveBeenCalled(); });
    expect(mocks.attachDocument).toHaveBeenCalledWith("t1", document);
    expect(mocks.saveManualLine).not.toHaveBeenCalled();
    expect(await screen.findByText("הקבלה צורפה לתנועה של Ajax Hardware")).toBeInTheDocument();
  });
});

describe("AddEntrySheet inline new project", () => {
  it("adds the project, picks it and says so in a toast", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "+ פרויקט חדש" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט החדש" }), { target: { value: "Willow Dr" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספה" }));
    expect(await screen.findByText("נוצר פרויקט Willow Dr")).toBeInTheDocument();
    expect(mocks.createProjectNamed).toHaveBeenCalledWith("Willow Dr");
    expect(screen.getByRole("button", { name: "Willow Dr" })).toHaveAttribute("aria-pressed", "true");
  });
});
