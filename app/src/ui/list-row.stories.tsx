import type { Meta, StoryObj } from "@storybook/react";
import { List, ListRow } from "./list-row";
import { largeAgorot, longHebrew, padded } from "./story-support";

/** Agorot is a decimal string so story args stay JSON-serializable. */
type RowArgs = {
  variant: "project" | "transaction" | "item" | "static" | "button" | "danger" | "selectable";
  title: string;
  hint?: string;
  href?: string;
  agorot?: string;
  loss?: boolean;
  sign?: "in" | "out";
  source?: "invoice" | "bank";
  selected?: boolean;
};

function RowView({ variant, title, hint, href, agorot = "0", loss, sign = "in", source = "invoice", selected = false }: RowArgs) {
  if (variant === "item") return <ListRow variant="item" title={title} hint={hint} href={href} />;
  if (variant === "static") return <ListRow variant="static" title={title} hint={hint} />;
  if (variant === "button") return <ListRow variant="button" title={title} hint={hint} onClick={() => undefined} />;
  if (variant === "danger") return <ListRow variant="danger" title={title} hint={hint} onClick={() => undefined} />;
  if (variant === "selectable") return <ListRow variant="selectable" title={title} hint={hint} selected={selected} onSelect={() => undefined} />;
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

export const Skeleton: Story = {
  tags: ["clip-no-text"],
  args: { variant: "item", title: "טוען" },
  render: () => (
    <List>
      <ListRow variant="skeleton" />
      <ListRow variant="skeleton" />
    </List>
  ),
};

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
export const Static: Story = {
  args: { variant: "static", title: "אלפא בנייה", hint: "עוסק מורשה" },
};
export const ButtonRow: Story = {
  args: { variant: "button", title: "חיבור SUMIT", hint: "מספר חברה ומפתח API" },
};
export const Danger: Story = {
  args: { variant: "danger", title: "התנתקות" },
};
export const Selectable: Story = {
  args: { variant: "selectable", title: "וילה רעננה", hint: "פעיל", selected: true },
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
export const Hover: Story = {
  args: { variant: "project", title: "וילה הרצליה", hint: "שיפוץ", agorot: "2000000" },
  render: () => (
    <div className="ui-project-list">
      <div className="ui-show-hover">
        <ListRow variant="project" title="וילה הרצליה" hint="שיפוץ" agorot={2_000_000n} />
      </div>
      <ListRow variant="project" title="משרד רמת גן" agorot={4_500_000n} />
    </div>
  ),
};

export const SharedNone: Story = {
  name: "Shared cost, no shares",
  args: { variant: "button", title: "עלות משותפת · טרם פוצלה" },
  render: () => (
    <List>
      <ListRow variant="button" title="עלות משותפת · טרם פוצלה" chevron onClick={() => undefined} />
    </List>
  ),
};

export const SharedOne: Story = {
  name: "Shared cost, one share",
  args: { variant: "button", title: "בניין מגורים חולון" },
  render: () => (
    <List>
      <ListRow variant="button" title="בניין מגורים חולון" chevron onClick={() => undefined} />
    </List>
  ),
};

export const ListOfRows: Story = {
  args: { variant: "project", title: "טק-ליין", agorot: "-2940000", loss: true },
  render: () => (
    <List>
      <ListRow variant="transaction" title="Sample vendor" hint="Utilities · 10/09" agorot={125_000n} sign="out" source="bank" currency="USD" />
      <ListRow variant="project" title="טק-ליין" agorot={-2_940_000n} loss />
      <ListRow variant="project" title={longHebrew} agorot={largeAgorot} />
    </List>
  ),
};
