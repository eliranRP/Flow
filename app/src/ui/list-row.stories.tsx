import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { BankIcon } from "./icons";
import { KeptOutTag, lineTagText } from "./line-marks";
import { List, ListRow, type ListLayout } from "./list-row";
import { largeAgorot, longHebrew, padded } from "./story-support";

/** Args are JSON: agorot is a decimal string, and the icon and the tag are flags the view draws. */
type RowArgs = {
  variant: "item" | "static" | "button" | "danger" | "skeleton" | "project" | "transaction" | "statement";
  layout: "none" | ListLayout;
  title: string;
  hint?: string;
  href?: string;
  chevron?: boolean;
  muted?: boolean;
  tone?: "warning" | "muted";
  setAside?: boolean;
  busy?: boolean;
  disabled?: boolean;
  icon?: boolean;
  tag?: boolean;
  agorot?: string;
  loss?: boolean;
  sign?: "in" | "out" | "cost";
  source?: "invoice" | "bank";
  currency?: string;
};

const noop = () => undefined;

function RowView(args: RowArgs) {
  const layout = args.layout === "none" ? undefined : args.layout;
  const amount = BigInt(args.agorot ?? "0");
  if (args.variant === "statement") {
    return <ListRow variant="statement" title={args.title} fallback={args.source === "bank" ? "bank" : "invoice"} agorot={amount} sign={args.sign === "in" ? "in" : "out"} href={args.href ?? "/review/all?item=1"} setAside={args.setAside} />;
  }
  if (args.variant === "skeleton") return <ListRow variant="skeleton" icon={args.icon} />;
  const copy = {
    layout,
    title: args.title,
    hint: args.hint,
    chevron: args.chevron,
    muted: args.muted,
    tone: args.tone,
    setAside: args.setAside,
    icon: args.icon ? <BankIcon /> : undefined,
    tag: args.tag ? <KeptOutTag label="לא נספר ברווח" /> : undefined,
  };
  if (args.variant === "item") return <ListRow variant="item" {...copy} href={args.href} />;
  if (args.variant === "static") return <ListRow variant="static" {...copy} busy={args.busy} />;
  if (args.variant === "button") return <ListRow variant="button" {...copy} busy={args.busy} disabled={args.disabled} onClick={noop} />;
  if (args.variant === "danger") return <ListRow variant="danger" {...copy} busy={args.busy} disabled={args.disabled} onClick={noop} />;
  if (args.variant === "project") {
    return <ListRow variant="project" {...copy} agorot={amount} loss={args.loss} currency={args.currency} href={args.href} />;
  }
  return <ListRow variant="transaction" {...copy} agorot={amount} sign={args.sign ?? "out"} source={args.source ?? "invoice"} currency={args.currency} href={args.href} />;
}

const meta = {
  title: "Components/ListRow",
  component: ListRow,
  tags: ["autodocs"],
  decorators: [padded],
  args: { variant: "item", layout: "none", title: "ביטוח המגן", hint: "ספק · פטור ממע״מ" },
  argTypes: {
    variant: {
      control: "select",
      options: ["item", "static", "button", "danger", "skeleton", "project", "transaction", "statement"],
    },
    layout: { control: "select", options: ["none", "flat", "inset"] },
    tone: { control: "select", options: [undefined, "warning", "muted"] },
    chevron: { control: "boolean" },
    muted: { control: "boolean" },
    setAside: { control: "boolean" },
    busy: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  render: (args) => <RowView {...args} />,
} satisfies Meta<RowArgs>;

export default meta;
type Story = StoryObj<RowArgs>;

export const Item: Story = {};
export const Static: Story = {
  args: { variant: "static", title: "אלפא בנייה", hint: "עוסק מורשה" },
};
export const Button: Story = {
  args: { variant: "button", title: "חיבור SUMIT", hint: "מספר חברה ומפתח API" },
  // FLOW-326: a <button> row starts its title and hint on the start side instead of centring them.
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole("button");
    await expect(getComputedStyle(row).textAlign).toBe("start");
    const title = row.querySelector(".ui-row-title");
    const hint = row.querySelector(".ui-row-hint");
    if (!(title instanceof HTMLElement) || !(hint instanceof HTMLElement)) throw new Error("row copy missing");
    const range = document.createRange();
    range.selectNodeContents(title);
    const titleEdge = range.getBoundingClientRect().right;
    range.selectNodeContents(hint);
    const hintEdge = range.getBoundingClientRect().right;
    await expect(Math.abs(titleEdge - hintEdge)).toBeLessThan(1.5);
  },
};
export const Danger: Story = {
  args: { variant: "danger", title: "התנתקות", hint: "הנתונים נשארים בחשבון" },
};
export const Skeleton: Story = {
  tags: ["clip-no-text"],
  args: { variant: "skeleton" },
  // FLOW-358: loading rows shaped like the loaded ones: an icon slot, and on an eyebrow row a short
  // label over a long value with nothing at the end (the loaded row has only a chevron there).
  render: () => (
    <List>
      <ListRow variant="skeleton" icon />
      <ListRow variant="skeleton" icon eyebrow end={false} />
    </List>
  ),
};
export const Project: Story = {
  args: { variant: "project", title: "טק-ליין", hint: "שיפוץ", agorot: "2940000", href: "/projects/tek" },
};
export const ProjectLoss: Story = {
  args: { variant: "project", title: "טק-ליין", hint: "שיפוץ", agorot: "-2940000", loss: true, href: "/projects/tek" },
};
export const Transaction: Story = {
  args: { variant: "transaction", title: "העברה", hint: "בנק · 12/09", agorot: "450000", sign: "out", source: "bank" },
};
export const TransactionIncome: Story = {
  args: { variant: "transaction", title: "קבלה 1042", hint: "חומרים · 12/09", agorot: "1800000", sign: "in", source: "invoice" },
};
export const Statement: Story = {
  args: { variant: "statement", title: "לקוח לדוגמה", agorot: "500000", sign: "in", source: "invoice" },
};
export const WithIcon: Story = {
  args: { variant: "item", title: "חשבון בנק", hint: "בנק הדואר · 03/10", icon: true },
};
export const WithTag: Story = {
  args: { variant: "transaction", title: "Sample supplier", hint: "10/05", agorot: "170000", sign: "cost", source: "bank", tag: true, setAside: true },
};
export const Muted: Story = {
  args: { variant: "item", title: "קטגוריה מוסתרת", hint: "מוסתרת", muted: true },
};
export const SetAside: Story = {
  args: { variant: "transaction", title: "החזר ציוד לדוגמה", hint: "לא נספר ברווח · ציוד · 02/10", agorot: "150000", sign: "out", setAside: true },
};
export const Busy: Story = {
  args: { variant: "button", title: "מרענן…", hint: "רענון הנתונים", busy: true },
};
export const Disabled: Story = {
  args: { variant: "button", title: "רענון עכשיו", hint: "אפשר לנסות שוב ב־12:00", disabled: true },
};
export const LongHebrew: Story = {
  args: { variant: "project", title: longHebrew, hint: longHebrew, agorot: String(largeAgorot), href: "/projects/long" },
};
export const LatinTitle: Story = {
  args: { variant: "transaction", title: "Sample vendor", hint: "Utilities · 10/09", agorot: "125000", sign: "out", source: "bank", currency: "USD" },
};

/** The show-hover tint: a row that tints on pointer hover only inside its wrapper. The e2e spec opens this id. */
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

/** FLOW-363 (2d): four rows on the background, no dividers, 64px tall. Invented names, round amounts. */
export const FlatList: Story = {
  args: { variant: "transaction", title: "קבלה 1042", layout: "flat" },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="קבלה 1042" hint="חומרים · 12/09" agorot={1_800_000n} sign="in" source="invoice" href="/transactions/1" />
      <ListRow layout="flat" variant="transaction" title="העברה" hint="בנק · 10/09" agorot={450_000n} sign="out" source="bank" href="/transactions/2" />
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="חומרים · 08/09" agorot={1_000_000n} sign="out" source="invoice" href="/transactions/3" />
      <ListRow layout="flat" variant="project" title="וילה לדוגמה" hint="רווחיות 27%" agorot={2_000_000n} href="/projects/1" />
    </List>
  ),
};

/** FLOW-363 (2d): four rows in one card, 14px inside and a hairline between rows. Invented names, round amounts. */
export const InsetList: Story = {
  args: { variant: "transaction", title: "קבלה 1042", layout: "inset" },
  render: () => (
    <List layout="inset">
      <ListRow layout="inset" variant="transaction" title="קבלה 1042" hint="חומרים · 12/09" agorot={1_800_000n} sign="in" source="invoice" href="/transactions/1" />
      <ListRow layout="inset" variant="transaction" title="העברה" hint="בנק · 10/09" agorot={450_000n} sign="out" source="bank" href="/transactions/2" />
      <ListRow layout="inset" variant="transaction" title="ספק לדוגמה" hint="חומרים · 08/09" agorot={1_000_000n} sign="out" source="invoice" href="/transactions/3" />
      <ListRow layout="inset" variant="project" title="וילה לדוגמה" hint="רווחיות 27%" agorot={2_000_000n} href="/projects/1" />
    </List>
  ),
};

/** FLOW-366: a transaction row with the supplier's initials in place of the source icon. Invented names and figures. */
export const TransactionInitials: Story = {
  args: { variant: "transaction", title: "סטודיו גל", hint: "דירת הגפן · חומרים", agorot: "120000", sign: "out", source: "invoice" },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="סטודיו גל" hint="דירת הגפן · חומרים" agorot={120_000n} sign="out" source="invoice" initials="סג" href="/transactions/1" />
      <ListRow layout="flat" variant="transaction" title="מים ושות׳" hint="בלי פרויקט · מים" agorot={45_000n} sign="out" source="invoice" initials="מו" href="/transactions/2" />
    </List>
  ),
};

/** FLOW-366: the tag line for a line awaiting review. */
export const TransactionPending: Story = {
  args: { variant: "transaction", title: "אור חשמל", hint: "בית הים · חשמל", agorot: "86000", sign: "out", source: "invoice" },
  render: () => (
    <List layout="flat">
      <ListRow
        layout="flat"
        variant="transaction"
        title="אור חשמל"
        hint="בית הים · חשמל"
        agorot={86_000n}
        sign="out"
        source="invoice"
        initials="אח"
        tagLine={lineTagText({ pending: true, inPnl: true, reason: null })}
        href="/transactions/3"
      />
    </List>
  ),
};

/** FLOW-366: the tag line for a loan's principal, which profit leaves out, and for a line that is both pending and out of profit. */
export const TransactionNotInProfit: Story = {
  args: { variant: "transaction", title: "בנק לדוגמה", hint: "בית הים · תשלום הלוואה", agorot: "150000", sign: "out", source: "bank" },
  render: () => (
    <List layout="flat">
      <ListRow
        layout="flat"
        variant="transaction"
        title="בנק לדוגמה"
        hint="בית הים · תשלום הלוואה"
        agorot={90_000n}
        sign="out"
        source="bank"
        initials="בל"
        tagLine={lineTagText({ pending: false, inPnl: false, reason: "קרן הלוואה" })}
        href="/transactions/4"
      />
      <ListRow
        layout="flat"
        variant="transaction"
        title="מים ושות׳"
        hint="דירת הגפן · שיפוץ"
        agorot={300_000n}
        sign="out"
        source="invoice"
        initials="מו"
        tagLine={lineTagText({ pending: true, inPnl: false, reason: "שיפוץ" })}
        href="/transactions/5"
      />
    </List>
  ),
};
