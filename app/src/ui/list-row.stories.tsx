import type { Meta, StoryObj } from "@storybook/react";
import { List, ListRow } from "./list-row";
import { largeAgorot, longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/ListRow",
  component: ListRow,
  decorators: [padded],
} satisfies Meta<typeof ListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Project: Story = {
  args: { variant: "project", title: "טק-ליין", hint: "שיפוץ", agorot: -2_940_000n, loss: true, href: "/projects/tek" },
};
export const TransactionIn: Story = {
  args: { variant: "transaction", title: "קבלה 1042", hint: "12/09/2026", agorot: 1_800_000n, sign: "in", source: "invoice" },
};
export const TransactionOut: Story = {
  args: { variant: "transaction", title: "העברה", hint: "בנק", agorot: 450_000n, sign: "out", source: "bank" },
};
export const Item: Story = {
  args: { variant: "item", title: "ביטוח המגן", hint: "ספק · פטור ממע״מ" },
};
export const EmptyHint: Story = {
  args: { variant: "project", title: "פרויקט בלי תנועות", agorot: 0n },
};
export const LongHebrew: Story = {
  args: { variant: "project", title: longHebrew, hint: longHebrew, agorot: largeAgorot, href: "/projects/long" },
};
export const LargeAmount: Story = {
  args: { variant: "transaction", title: "חשבונית גדולה", agorot: largeAgorot, sign: "in", source: "invoice" },
};
export const ListOfRows: Story = {
  args: { variant: "project", title: "טק-ליין", agorot: -2_940_000n, loss: true },
  render: () => (
    <List>
      <ListRow variant="project" title="טק-ליין" agorot={-2_940_000n} loss />
      <ListRow variant="project" title={longHebrew} agorot={largeAgorot} />
    </List>
  ),
};
