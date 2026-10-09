import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import type { TxnMeta } from "../txn-meta";
import { BankDetails } from "./bank-details";

/**
 * FLOW-304's פרטי הבנק section on the transaction detail. FLOW-315: a memo longer than 4 lines is a
 * button with a ▾ cue, like the review card's memo; the cue turns over while the memo is open.
 */
const longMemo = "Invoice 1042 for the September office lease, parking for two cars, storage unit B, after-hours cleaning, the shared kitchen supplies, the lobby badge reissue, and the late fee that was waived by the landlord in August after the elevator repair";

function details(memo: string): TxnMeta {
  return {
    transaction_id: "t-story",
    method: "ach",
    card_last4: null,
    memo,
    account: "Mercury Checking ••1234",
    counterparty: null,
    bank_description: null,
  };
}

function Demo({ memo }: { memo: string }) {
  return <BankDetails meta={details(memo)} party="Example Office Suite" direction="expense" />;
}

const meta = {
  title: "Components/BankDetails",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** A memo past 4 lines: clamped, with the ▾ cue at the row's end. */
export const LongMemo: Story = {
  args: { memo: longMemo },
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /הערה/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(canvasElement.querySelector(".ui-bank-memo-cue")).not.toBeNull();
  },
};
export const LongMemoDark: Story = { ...LongMemo, name: "Long memo, dark", ...dark };
export const LongMemo320: Story = { ...LongMemo, name: "Long memo, 320", ...at320 };

/** Opened: the whole memo shows and the cue points up. */
export const LongMemoOpen: Story = {
  name: "Long memo, open",
  args: { memo: longMemo },
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /הערה/ });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvasElement.querySelector(".ui-bank-memo-cue")).toHaveAttribute("data-open");
  },
};

export const LongMemoOpenDark: Story = { ...LongMemoOpen, name: "Long memo, open, dark", ...dark };

/** A short memo is plain text: no button, no cue. */
export const ShortMemo: Story = {
  args: { memo: "Invoice 1042, September lease" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
    await expect(canvasElement.querySelector(".ui-bank-memo-cue")).toBeNull();
  },
};
