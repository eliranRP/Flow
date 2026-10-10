import type { CashLine } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CashLineRows, CashMonthLines } from "./cash-line-rows";
import { at320, dark } from "./screen-stories-support";
import { StoryRoute } from "./story-route";

/** FLOW-438: a month's cash lines in the project's תנועות rows. Invented names and figures. */

const meta = {
  title: "Components/Cash line rows",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function line(id: string, title: string, category: string, minor: bigint, side: "in" | "out" = "out"): CashLine {
  const day = `2026-10-0${id}`;
  return {
    transaction_id: id,
    part: null,
    description: title,
    supplier_name: title,
    project_name: null,
    category_name: category,
    doc_date: day,
    cash_month_date: day,
    currency: "USD",
    amount_minor: minor,
    side,
    source: "mercury",
  };
}

const counted = [line("3", "שוכר לדוגמה", "שכירות", 250_000n, "in"), line("5", "חברת ניהול לדוגמה", "ניהול נכס", 25_000n)];
const kept = [line("2", "חנות חומרים לדוגמה", "קבלני משנה וחומרי גמר", 640_000n), line("1", "מלווה לדוגמה", "תשלומי הלוואה", 180_900n)];

/** The month page's list: newest first, and the lines profit leaves out in place, quiet and marked. */
export const MonthLines: Story = {
  render: () => (
    <StoryRoute entry="/">
      <CashMonthLines counted={counted} kept={kept} search="" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const links = canvas.getAllByRole("link");
    await expect(links).toHaveLength(4);
    await expect(links[0]).toHaveAccessibleName(/^חברת ניהול לדוגמה/);
    await expect(canvas.getAllByText("לא נספר ברווח")).toHaveLength(2);
  },
};
export const MonthLinesDark: Story = { ...MonthLines, ...dark };
/** A long kept-out category drops whole; amounts stay in line. */
export const MonthLines320: Story = { ...MonthLines, ...at320 };

/** The יצא page's rows, which share the component. */
export const OutLines: Story = {
  render: () => (
    <StoryRoute entry="/">
      <CashLineRows rows={[...counted.slice(1), ...kept]} list="out" search="" />
    </StoryRoute>
  ),
};
