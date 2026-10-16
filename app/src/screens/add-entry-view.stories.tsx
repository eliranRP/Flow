import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
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
      draft={draft}
      onDraftChange={setDraft}
      formatMoney={(minor) => formatAmount(BigInt(minor), "detail")}
      onClose={() => undefined}
      onSave={() => undefined}
      onAddProject={() => Promise.resolve("p3")}
      onAddCategory={() => Promise.resolve("c4")}
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

/** Cash from a project: the title names it, the save waits for the amount, the payee and a category. */
export const CashFromProject: Story = {
  args: { fromProject: "Oak Ridge", start: { payee: "", categoryId: null } },
};

/** The same form at 320 wide: the two-column date row and the chips still wrap. */
export const CashFromProject320: Story = {
  ...CashFromProject,
  parameters: { viewport: { defaultViewport: "flow320" } },
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

export const ReceiptMatched393: Story = {
  ...ReceiptMatched,
  parameters: { viewport: { defaultViewport: "flow393" } },
};
