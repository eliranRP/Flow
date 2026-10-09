import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import type { TransactionDetail } from "@flow/shared";
import { TransactionScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

/**
 * FLOW-345 option D (owner, 2026-10-09): a card opened from a list walks it with הקודמת · "2 מתוך 3" ·
 * הבאה in a quiet row at the bottom, in the thumb zone. The top bar keeps Back and ⋯. At a list end
 * that side's word is hidden and the counter stays in the middle. Invented sample data.
 */
const meta = {
  title: "Screens/Transaction step",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ids = ["t0", "t1", "t2"];

const cards: Array<NonNullable<TransactionDetail>> = [
  {
    id: "t0",
    description: "שכירות פיגומים",
    direction: "expense",
    doc_date: "2026-09-20",
    amount_gross: -472_000n,
    amount_net: -400_000n,
    vat_amount: -72_000n,
    vat_status: "source",
    doc_kind: "invoice",
    source: "sumit",
    project_id: "holon",
    project_name: "בניין מגורים חולון",
    category_id: "c2",
    category_name: "ציוד והשכרה",
    supplier_name: "פיגומים לדוגמה בע״מ",
    customer_name: null,
    review_status: "approved",
    paid: true,
    open_gross_agorot: null,
  },
  {
    id: "t1",
    description: "חשבונית חומרים",
    direction: "expense",
    doc_date: "2026-09-21",
    amount_gross: -1_003_000n,
    amount_net: -850_000n,
    vat_amount: -153_000n,
    vat_status: "source",
    doc_kind: "invoice",
    source: "sumit",
    project_id: "holon",
    project_name: "בניין מגורים חולון",
    category_id: "c1",
    category_name: "חומרים",
    supplier_name: "חומרי בניין השרון בע״מ",
    customer_name: null,
    review_status: "approved",
    paid: true,
    open_gross_agorot: null,
  },
  {
    id: "t2",
    description: "הובלה",
    direction: "income",
    doc_date: "2026-09-22",
    amount_gross: 12_345_678n,
    amount_net: 10_462_439n,
    vat_amount: 1_883_239n,
    vat_status: "source",
    doc_kind: "invoice",
    source: "sumit",
    project_id: "holon",
    project_name: "בניין מגורים חולון",
    category_id: "c1",
    category_name: "הכנסות מפרויקט",
    supplier_name: null,
    customer_name: "לקוח לדוגמה עם שם ארוך מאוד לבדיקה",
    review_status: "open",
    paid: false,
    open_gross_agorot: 12_345_678n,
  },
];

/** The neighbours in the cache, as the live card's prefetch leaves them: a drag peeks their names. */
function SeedNeighbours({ at }: { at: number }) {
  const client = useQueryClient();
  useState(() => {
    for (const card of [cards[at - 1], cards[at + 1]]) {
      if (card) client.setQueryData(["txn", "off", card.id], card);
    }
    return true;
  });
  return null;
}

function StepStory({ at }: { at: number }) {
  const card = cards[at];
  if (!card) return null;
  return (
    <StoryRoute entry={`/transactions/${card.id}`} state={{ txnList: { ids, from: "/projects/holon" } }}>
      <ExampleBar />
      <SeedNeighbours at={at} />
      <TransactionScreen sample={card} />
    </StoryRoute>
  );
}

function row(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole("group", { name: "מעבר בין תנועות" });
}

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** The first row: הקודמת is hidden in its place, so "1 מתוך 3" stays centred. */
export const First: Story = {
  name: "First in a list",
  render: () => <StepStory at={0} />,
  play: async ({ canvasElement }) => {
    await expect(row(canvasElement)).toHaveTextContent("1 מתוך 3");
    await expect(within(canvasElement).getByText("הקודמת")).not.toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הבאה" })).toBeVisible();
  },
};
export const First320: Story = { ...First, name: "First in a list, 320", ...at320 };
export const FirstDark: Story = { ...First, name: "First in a list, dark", ...dark };

/** A middle row: both words, the counter between them, and no arrows in the top bar. */
export const Middle: Story = {
  name: "In a list",
  render: () => <StepStory at={1} />,
  play: async ({ canvasElement }) => {
    await expect(row(canvasElement)).toHaveTextContent(/^הקודמת.*2 מתוך 3.*הבאה$/);
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הקודמת" })).toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הבאה" })).toBeVisible();
  },
};
export const Middle320: Story = { ...Middle, name: "In a list, 320", ...at320 };
export const MiddleDark: Story = { ...Middle, name: "In a list, dark", ...dark };

/** The last row: הבאה is hidden in its place. */
export const Last: Story = {
  name: "Last in a list",
  render: () => <StepStory at={2} />,
  play: async ({ canvasElement }) => {
    await expect(row(canvasElement)).toHaveTextContent("3 מתוך 3");
    await expect(within(canvasElement).getByText("הבאה")).not.toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "התנועה הקודמת" })).toBeVisible();
  },
};
export const Last320: Story = { ...Last, name: "Last in a list, 320", ...at320 };
export const LastDark: Story = { ...Last, name: "Last in a list, dark", ...dark };
