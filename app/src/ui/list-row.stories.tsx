import type { Meta, StoryObj } from "@storybook/react";
import { List, ListRow } from "./list-row";
import { largeAgorot, longHebrew, padded } from "./story-support";

/** Agorot is a decimal string so story args stay JSON-serializable. */
type RowArgs = {
  variant: "project" | "transaction" | "item";
  title: string;
  hint?: string;
  href?: string;
  agorot?: string;
  loss?: boolean;
  sign?: "in" | "out";
  source?: "invoice" | "bank";
};

function RowView({ variant, title, hint, href, agorot = "0", loss, sign = "in", source = "invoice" }: RowArgs) {
  if (variant === "item") return <ListRow variant="item" title={title} hint={hint} href={href} />;
  if (variant === "transaction") {
    return <ListRow variant="transaction" title={title} hint={hint} href={href} agorot={BigInt(agorot)} sign={sign} source={source} />;
  }
  return <ListRow variant="project" title={title} hint={hint} href={href} agorot={BigInt(agorot)} loss={loss} />;
}

const meta = {
  title: "Components/ListRow",
  component: RowView,
  decorators: [padded],
} satisfies Meta<typeof RowView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Project: Story = {
  args: { variant: "project", title: "טק-ליין", hint: "שיפוץ", agorot: "-2940000", loss: true, href: "/projects/tek" },
};
export const TransactionIn: Story = {
  args: { variant: "transaction", title: "קבלה 1042", hint: "חומרים · 12/09", agorot: "1800000", sign: "in", source: "invoice" },
};
export const TransactionOut: Story = {
  args: { variant: "transaction", title: "העברה", hint: "בנק", agorot: "450000", sign: "out", source: "bank" },
};
export const Item: Story = {
  args: { variant: "item", title: "ביטוח המגן", hint: "ספק · פטור ממע״מ" },
};
export const EmptyHint: Story = {
  args: { variant: "project", title: "פרויקט בלי תנועות", agorot: "0" },
};
export const LongHebrew: Story = {
  args: { variant: "project", title: longHebrew, hint: longHebrew, agorot: String(largeAgorot), href: "/projects/long" },
};
export const LargeAmount: Story = {
  args: { variant: "transaction", title: "חשבונית גדולה", agorot: String(largeAgorot), sign: "in", source: "invoice" },
};
export const ListOfRows: Story = {
  args: { variant: "project", title: "טק-ליין", agorot: "-2940000", loss: true },
  render: () => (
    <List>
      <ListRow variant="project" title="טק-ליין" agorot={-2_940_000n} loss />
      <ListRow variant="project" title={longHebrew} agorot={largeAgorot} />
    </List>
  ),
};
