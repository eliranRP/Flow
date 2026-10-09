import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
import { List, ListRow } from "./list-row";
import { TxnStepRow } from "./txn-step-row";

/**
 * FLOW-345 option D: הקודמת · "2 מתוך 3" · הבאה, pinned at the bottom of the screen in the thumb zone. At a
 * list end that side's word is hidden and keeps its box, so the counter stays centred. The row is filled
 * with the page colour; a hairline shows on top only while content is scrolled under it.
 */
function Demo({ start, total, rows }: { start: number; total: number; rows: number }) {
  const [at, setAt] = useState(start);
  return (
    <div className="ui-txn-stepped">
      <List>
        {Array.from({ length: rows }, (_, i) => (
          <ListRow key={i} variant="static" eyebrow="שורה" title={`ספק ${String(i + 1)}`} />
        ))}
      </List>
      <TxnStepRow
        index={at}
        total={total}
        atStart={at === 1}
        atEnd={at === total}
        onPrev={() => { setAt((n) => Math.max(1, n - 1)); }}
        onNext={() => { setAt((n) => Math.min(total, n + 1)); }}
      />
    </div>
  );
}

const meta = {
  title: "Components/TxnStepRow",
  component: Demo,
  args: { start: 2, total: 3, rows: 2 },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

function group(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole("group", { name: "מעבר בין תנועות" });
}

/** The first card: הקודמת is hidden in its place, so "1 מתוך 3" stays centred. */
export const First: Story = {
  args: { start: 1 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("הקודמת")).not.toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הבאה" })).toBeVisible();
    await expect(within(canvasElement).getByText("1 מתוך 3")).toBeInTheDocument();
  },
};

/** A middle card: both words, the counter between them. Short content ends above the row: no hairline. */
export const Middle: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הקודמת" })).toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הבאה" })).toBeVisible();
    await expect(group(canvasElement)).not.toHaveAttribute("data-under");
  },
};
export const Middle320: Story = { ...Middle, name: "Middle, 320", ...at320 };
export const MiddleDark: Story = { ...Middle, name: "Middle, dark", ...dark };

/** The last card: הבאה is hidden in its place. */
export const Last: Story = {
  args: { start: 3 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("הבאה")).not.toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הקודמת" })).toBeVisible();
  },
};

/** Content runs on under the row: the hairline shows on top of it. 12 of 24 reserves two digits. */
export const ContentUnder: Story = {
  name: "Content under the row",
  args: { start: 12, total: 24, rows: 30 },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(group(canvasElement)).toHaveAttribute("data-under"));
    await expect(within(canvasElement).getByText("12 מתוך 24")).toBeInTheDocument();
  },
};
export const ContentUnderDark: Story = { ...ContentUnder, name: "Content under the row, dark", ...dark };
