// FLOW-369: the add form. Save waits for the four fields, a new name that exists keeps הוספה off,
// a new chip is added and picked, and a matched receipt says it attaches to the bank line.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type BankMatch, type EntryDraft } from "../add-entry";
import { AddEntryView, type AddEntryViewProps } from "./add-entry-view";

const TODAY = "16/10/2026";
const projects = [{ id: "p1", name: "Oak Ridge" }];
const categories = [{ id: "c1", name: "ציוד", kind: "expense" as const }];

function setup(overrides: Partial<AddEntryViewProps> = {}, draft: Partial<EntryDraft> = {}) {
  const props: AddEntryViewProps = {
    kind: "cash",
    projects,
    categories,
    draft: { ...emptyDraft(null, TODAY), ...draft },
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

describe("AddEntryView save rule", () => {
  it("stays off until the amount, the payee, the project and the category are set", () => {
    const { unmount } = setup({}, { ...complete, payee: "" });
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
    unmount();
    setup({}, complete);
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();
  });

  it("calls onSave with the draft once everything is set", () => {
    const { props } = setup({}, complete);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: "12.50", projectId: "p1" }));
  });
});

describe("AddEntryView inline new project", () => {
  it("keeps הוספה off for a name that already exists", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ פרויקט חדש" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שם הפרויקט החדש" }), { target: { value: "Oak Ridge" } });
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
    setup({ fromProject: "Oak Ridge" });
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
