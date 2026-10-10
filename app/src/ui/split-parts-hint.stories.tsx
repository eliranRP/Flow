import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { List, ListRow } from "./list-row";
import { at320, dark } from "./screen-stories-support";
import { SplitPartsHint } from "./split-parts-hint";
import { StoryRoute } from "./story-route";

/** FLOW-432: a split line's row in a cash list names the parts it counts, out of the whole line. Invented figures. */

const meta = {
  title: "Components/SplitPartsHint",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const refunds = [
  { name: "מים וביוב", amount: "$183.10" },
  { name: "חשמל", amount: "$171.76" },
];

function Rows() {
  return (
    <StoryRoute entry="/">
      <List>
        <ListRow
          variant="transaction"
          source="bank"
          title="Example Water Co"
          hint="07/10 · מים וביוב"
          agorot={5_779n}
          currency="USD"
          sign="out"
          href="/transactions/a"
        />
        <ListRow
          variant="transaction"
          source="bank"
          title="EXAMPLE RENT PORTAL; TRANSFER"
          hint={
            <SplitPartsHint parts={refunds} total="$2,054.86" date="07/10" />
          }
          wrapHint
          agorot={35_486n}
          currency="USD"
          sign="in"
          inWord="זיכוי"
          href="/transactions/b"
        />
        <ListRow
          variant="transaction"
          source="bank"
          title="Example Property Manager"
          hint={
            <SplitPartsHint
              parts={[
                { name: "תיקונים", amount: "$300" },
                { name: "גינון", amount: "$120" },
                { name: "ניקיון", amount: "$80" },
              ]}
              total="$1,500"
              date="05/10"
            />
          }
          wrapHint
          agorot={50_000n}
          currency="USD"
          sign="out"
          href="/transactions/c"
        />
        <ListRow
          variant="transaction"
          source="bank"
          title="Example Tenant"
          hint={
            <SplitPartsHint
              parts={[{ name: "הכנסות שכירות", amount: "$1,700" }]}
              total="$2,054.86"
              date="07/10"
            />
          }
          wrapHint
          agorot={170_000n}
          currency="USD"
          sign="in"
          href="/transactions/d"
        />
      </List>
    </StoryRoute>
  );
}

export const CashList: Story = {
  name: "Split lines in a cash list",
  render: () => <Rows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("$171.76")).toBeInTheDocument();
    await expect(canvas.getAllByText("$2,054.86")).toHaveLength(2);
    await expect(canvas.getByText("$1,500")).toBeInTheDocument();
    await expect(canvas.getByText("· ועוד 2", { exact: false })).toBeInTheDocument();
  },
};

export const CashListDark: Story = {
  ...CashList,
  name: "Split lines in a cash list, dark",
  ...dark,
};
export const CashList320: Story = {
  ...CashList,
  name: "Split lines in a cash list, 320",
  ...at320,
};

/** FLOW-425: long names and wide amounts. An amount is never cut: it shows whole or, after "ועוד N", drops. */
function LongRows() {
  return (
    <StoryRoute entry="/">
      <List>
        <ListRow
          variant="transaction"
          source="bank"
          title="Example Utilities"
          hint={
            <SplitPartsHint
              parts={[
                { name: "שיפוץ והשבחה", amount: "$1,234.56" },
                { name: "חשמל ומים משותפים", amount: "$1,111.11" },
              ]}
              total="$3,456.78"
              date="07/10"
            />
          }
          wrapHint
          agorot={234_567n}
          currency="USD"
          sign="out"
          href="/transactions/e"
        />
        <ListRow
          variant="transaction"
          source="bank"
          title="Example Long Supplier Name Holdings LLC"
          hint={
            <SplitPartsHint
              parts={[
                { name: "שיפוץ והשבחה כללי בבניין", amount: "$10,000" },
                { name: "אינטרנט ותקשורת", amount: "$1,345.67" },
                { name: "ניקיון", amount: "$1,000" },
              ]}
              total="$98,765.43"
              date="05/10"
            />
          }
          wrapHint
          agorot={1_234_567n}
          currency="USD"
          sign="out"
          href="/transactions/f"
        />
      </List>
    </StoryRoute>
  );
}

/**
 * Each amount (and the date) is inside the boxes that clip it, or wholly outside one (dropped), never
 * part-way. A dropped date is hidden by its own box, so the walk stops there (FLOW-914).
 */
function clippedAmounts(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".ui-split-hint-amount, .ui-split-hint-date-in")].flatMap((amount) => {
    const box = amount.getBoundingClientRect();
    for (let el = amount.parentElement; el && el !== root; el = el.parentElement) {
      if (getComputedStyle(el).overflow === "visible") continue;
      const clip = el.getBoundingClientRect();
      const inside = box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5 && box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5;
      const outside = box.top >= clip.bottom - 0.5 || box.bottom <= clip.top + 0.5;
      if (outside) return [];
      if (!inside) return [amount.textContent];
    }
    return [];
  });
}

export const LongNames: Story = {
  name: "Split lines with long names",
  render: () => <LongRows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("$1,234.56")).toBeInTheDocument();
    await expect(canvas.getByText("· ועוד 2", { exact: false })).toBeInTheDocument();
    await expect(clippedAmounts(canvasElement)).toEqual([]);
    // The word "מתוך" is never cut; in a narrow column the total wraps under it instead.
    const words = [...canvasElement.querySelectorAll<HTMLElement>(".ui-split-hint-of-word")];
    await expect(words.filter((word) => word.scrollWidth > word.clientWidth + 1)).toEqual([]);
  },
};

export const LongNames320: Story = {
  ...LongNames,
  name: "Split lines with long names, 320",
  ...at320,
};
