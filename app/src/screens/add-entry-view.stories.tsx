import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { emptyDraft, type BankMatch, type EntryDraft } from "../add-entry";
import { formatAmount } from "../ui/amount";
import { AddEntryView, type AddEntryViewProps } from "./add-entry-view";

// FLOW-369: the add form is a tall sheet. Fixed sample data: no real names, dates pinned.
const projects = [
  { id: "p1", name: "Oak Ridge" },
  { id: "p2", name: "Cedar Court" },
];
const categories = [
  { id: "c1", name: "ציוד", kind: "expense" as const },
  { id: "c2", name: "הובלה", kind: "expense" as const },
  { id: "c3", name: "אחר", kind: "expense" as const },
  { id: "c4", name: "שכירות", kind: "income" as const },
];
const match: BankMatch = { id: "t1", description: "Ajax Hardware", doc_date: "2026-10-10", amount_minor: 40901, source: "SUMIT" };

function Demo(props: Partial<AddEntryViewProps> & { start?: Partial<EntryDraft> }) {
  const { start, ...rest } = props;
  const [draft, setDraft] = useState<EntryDraft>({ ...emptyDraft("p1", "16/10/2026"), ...start });
  return (
    <AddEntryView
      kind="cash"
      projects={projects}
      categories={categories}
      edit={draft}
      onDraftChange={setDraft}
      formatMoney={(minor) => formatAmount(BigInt(minor), "detail")}
      onClose={() => undefined}
      onSave={() => undefined}
      onAddProject={() => Promise.resolve("p3")}
      onAddCategory={() => Promise.resolve("c9")}
      onAttach={() => undefined}
      {...rest}
    />
  );
}

const meta = {
  title: "Screens/AddEntry",
  component: Demo,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Cash from a project: the title names it; save is never disabled. */
export const CashFromProject: Story = {
  args: { fromProject: "Oak Ridge", start: { payee: "", categoryId: null } },
};

/** A receipt with a matched bank line: the box names it and the save attaches to it. */
export const ReceiptMatched: Story = {
  args: {
    kind: "receipt",
    match,
    document: { name: "ajax-receipt.jpg", mime: "image/jpeg", bytes: 183000, sha256: "a".repeat(64) },
    start: { payee: "Ajax Hardware", amount: "409.01", categoryId: "c1" },
  },
};

/** FLOW-966: save tapped with fields missing: each says what it needs, and the amount takes the focus. */
export const Missing: Story = {
  args: { start: { projectId: null, categoryId: null } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = body.getByRole("dialog");
    await waitFor(async () => { await expect(getComputedStyle(dialog).pointerEvents).not.toBe("none"); });
    await userEvent.click(body.getByRole("button", { name: "שמירת ההוצאה" }));
    await expect(body.getByText("חסר סכום")).toBeVisible();
    await expect(body.getByText("בחרו קטגוריה")).toBeVisible();
  },
};

/** FLOW-966: income by cheque, every field set: the save names what it saves. */
export const IncomeCheque: Story = {
  args: { start: { direction: "in", method: "cheque", cheque: "1048", amount: "2,400.00", payee: "Dana R.", categoryId: "c4" } },
};
