import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CashRows, type CashRow } from "./cash-rows";
import { at320, dark } from "./screen-stories-support";
import { StoryRoute } from "./story-route";

/** FLOW-413 + FLOW-417: the cash view's rows under a month's figure. Invented figures. */

const meta = {
  title: "Components/CashRows",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ils = (minor: bigint) => [{ currency: "ILS", minor }];

const rows: CashRow[] = [
  { id: "in", label: "נכנס", tone: "in", amounts: ils(1_800_000n), href: "/cash/2026-10/in/ILS", name: "נכנס באוקטובר ₪18,000 – פירוט" },
  { id: "out", label: "יצא", tone: "out", amounts: ils(1_480_000n), href: "/cash/2026-10/out/ILS", name: "יצא באוקטובר ₪14,800 – פירוט" },
  { id: "profit", label: "רווח החודש", tone: "quiet", amounts: ils(560_000n), href: "/profit", name: "רווח באוקטובר ₪5,600" },
  {
    id: "kept",
    label: "לא נספר ברווח",
    hint: "שיפוץ והשבחה, השקעת בעלים",
    tone: "aside",
    amounts: ils(-240_000n),
    href: "/cash/2026-10/kept/ILS",
    name: "לא נספר ברווח באוקטובר −₪2,400 – פירוט",
  },
];

export const Month: Story = {
  name: "A month: in, out, profit and what profit leaves out",
  render: () => (
    <StoryRoute entry="/">
      <CashRows rows={rows} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kept = canvas.getByRole("link", { name: /^לא נספר ברווח/ });
    await expect(within(kept).getByText("שיפוץ והשבחה, השקעת בעלים")).toBeInTheDocument();
  },
};
export const MonthDark: Story = { ...Month, name: "A month, dark", ...dark };
export const Month320: Story = { ...Month, name: "A month, 320", ...at320 };
