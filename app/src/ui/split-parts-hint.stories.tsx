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
    await expect(
      canvas.getByText("מתוך", { exact: false, selector: "span" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("$171.76")).toBeInTheDocument();
    await expect(canvas.getByText("ועוד 2")).toBeInTheDocument();
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
