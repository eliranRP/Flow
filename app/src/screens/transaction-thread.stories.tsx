import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { THREAD_KEY, type Thread } from "../transaction-thread";
import { StoryRoute } from "../ui/story-route";
import { TransactionThread } from "./transaction-thread";
import { BeforeApproveSheet } from "./review-thread";

/**
 * FLOW-957 (boards "A · Thread — transaction page" and "C · Sheet — approval card", owner 2026-10-25):
 * a line's notes and files, Mercury's note first, and the sheet before approving. Invented sample data.
 */
const meta = {
  title: "Screens/Transaction thread",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const mercury = {
  id: "m1",
  source: "mercury" as const,
  body: "Lumber for back deck, invoice #4471",
  mine: false,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  edited: false,
  edited_in_flow: false,
};

const mercuryReceipt = { id: "f1", note_id: null, source: "mercury" as const, file_name: "receipt-4471.pdf", mime: "application/pdf", bytes: 52_000, path: "c1/t1/m-receipt.pdf", mine: false, created_at: "2026-10-10T10:00:00Z" };

const mixed: Thread = {
  transaction_id: "t1",
  company_id: "c1",
  notes: [
    mercury,
    { id: "n1", source: "flow", body: "לבדוק מול הצעת המחיר של הקבלן לפני שמשייכים לשלב ב׳.", mine: true, created_at: "2026-10-22T06:40:00Z", updated_at: "2026-10-22T06:40:00Z", edited: false, edited_in_flow: false },
  ],
  files: [
    mercuryReceipt,
    { id: "f2", note_id: "n1", source: "flow", file_name: "deck.jpg", mime: "image/jpeg", bytes: 1_258_291, path: "c1/t1/deck.jpg", mine: true, created_at: "2026-10-22T06:40:00Z" },
  ],
};

const mercuryOnly: Thread = { ...mixed, notes: [{ ...mercury, edited_in_flow: true, edited: true, updated_at: "2026-10-23T09:00:00Z" }], files: [mercuryReceipt] };
const empty: Thread = { ...mixed, notes: [], files: [] };

function Seed({ thread }: { thread: Thread }) {
  const client = useQueryClient();
  useState(() => {
    client.setQueryData([THREAD_KEY, "off", thread.transaction_id], thread);
    return true;
  });
  return null;
}

function ThreadStory({ thread, viewer = false }: { thread: Thread; viewer?: boolean }) {
  return (
    <StoryRoute entry="/transactions/t1" viewer={viewer}>
      <Seed thread={thread} />
      <div className="ui-page-pad">
        <TransactionThread transactionId="t1" holdWrites={viewer} />
      </div>
    </StoryRoute>
  );
}

/** Mercury's note with its receipt, then the owner's note with a photo, and the composer. */
export const Mixed: Story = {
  render: () => <ThreadStory thread={mixed} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "הערות וקבצים" })).toBeVisible();
    await expect(canvas.getByText("Lumber for back deck, invoice #4471")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "צירוף קובץ" })).toBeVisible();
  },
};

/** Mercury's note edited in Flow: the edit stays in Flow, and the card says Mercury kept its own text. */
export const MercuryOnly: Story = {
  render: () => <ThreadStory thread={mercuryOnly} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/ב־Mercury ההערה לא השתנתה$/)).toBeVisible();
  },
};

export const Empty: Story = {
  render: () => <ThreadStory thread={empty} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("עוד אין כאן הערות או קבצים.")).toBeVisible();
  },
};

/** A viewer reads the thread: no composer, no edit. */
export const Viewer: Story = {
  render: () => <ThreadStory thread={mixed} viewer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Lumber for back deck, invoice #4471")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "צירוף קובץ" })).toBeNull();
  },
};

/** The approval card's sheet: Mercury's note, a photo, a file or a note, then לשמור ולאשר. */
export const BeforeApproving: Story = {
  render: () => (
    <StoryRoute entry="/review">
      <Seed thread={{ ...mixed, notes: [mercury], files: [mercuryReceipt] }} />
      <BeforeApproveSheet open onOpenChange={() => undefined} transactionId="t1" approveDisabled={false} onApprove={() => undefined} />
    </StoryRoute>
  ),
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByRole("heading", { name: "לפני שמאשרים" })).toBeVisible();
    await expect(body.getByRole("button", { name: "צילום" })).toBeVisible();
    await expect(body.getByRole("button", { name: "לאשר" })).toBeVisible();
  },
};
