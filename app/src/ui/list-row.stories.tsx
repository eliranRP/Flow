import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import { BigNumber } from "./big-number";
import { BankIcon } from "./icons";
import { List, ListRow } from "./list-row";
import { statementMethodOf } from "./statement";
import { largeAgorot, longHebrew, padded, storyMeta } from "./story-support";

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

/** Option C (decision 0114): income green with no plus and small cents (".00" included), expense with − and cents,
    a negative income with its minus and never green, and a project row in whole units. No hairlines. */
function MercuryRows() {
  return (
    <List>
      <ListRow variant="transaction" title="לקוח לדוגמה" hint="מקדמה · 14/09" agorot={1_200_000n} sign="in" source="invoice" href="/transactions/1" />
      <ListRow variant="transaction" title="לקוח שני" hint="תשלום · 12/09" agorot={345_050n} sign="in" source="bank" href="/transactions/2" />
      <ListRow variant="transaction" title="ספק לדוגמה" hint="חומרים · 10/09" agorot={123_456n} sign="out" source="invoice" href="/transactions/3" />
      <ListRow variant="transaction" title="זיכוי ללקוח" hint="זיכוי · 08/09" agorot={-20_000n} sign="in" source="invoice" href="/transactions/4" />
      <ListRow variant="project" title="פרויקט לדוגמה" hint="רווחיות 27%" agorot={2_940_000n} href="/projects/1" />
      <ListRow
        variant="static"
        title="הכנסה שלילית בסיכום"
        meta={<BigNumber agorot={-40_000n} income />}
      />
    </List>
  );
}

export const MercuryLight: Story = {
  args: { variant: "transaction", title: "לקוח לדוגמה" },
  render: () => <MercuryRows />,
};
export const MercuryDark: Story = {
  args: { variant: "transaction", title: "לקוח לדוגמה" },
  globals: { theme: "dark" },
  render: () => <MercuryRows />,
};

/**
 * FLOW-305 option A: the statement row. Initials in the tint, the counterparty, a pending chip and
 * "✦ project · category", the amount with small cents and the method under it. Invented data.
 */
const bankMethod = statementMethodOf("mercury", undefined);
const invoiceMethod = statementMethodOf("sumit", "invoice");
// FLOW-305 with FLOW-304 bank details: the method comes from the line's meta. Invented card digits.
const cardMethod = statementMethodOf("mercury", undefined, storyMeta("t-card", { method: "card", card_last4: "4242" }));
const achMethod = statementMethodOf("mercury", undefined, storyMeta("t-ach", { method: "ach" }));
const wireMethod = statementMethodOf("mercury", undefined, storyMeta("t-wire", { method: "wire" }));
const checkMethod = statementMethodOf("mercury", undefined, storyMeta("t-check", { method: "check" }));
const noMetaMethod = statementMethodOf("mercury", undefined, null);

type BankKind = "card" | "ach" | "wire" | "check" | "none";

/** One bank line per payment method, and one with no bank details ("בנק"). */
function StatementBankRows({ only }: { only?: BankKind }) {
  const rows: Record<BankKind, ReactElement> = {
    card: <ListRow key="card" variant="statement" title="Northwind Traders" fallback="bank" method={cardMethod} agorot={-4_299n} currency="USD" sign="out" href="/review/all?item=11" />,
    ach: <ListRow key="ach" variant="statement" title="Fabrikam Supply Co" fallback="bank" method={achMethod} suggestion="וילה לדוגמה · חומרים" agorot={-245_000n} currency="USD" sign="out" href="/review/all?item=12" />,
    wire: <ListRow key="wire" variant="statement" title="לקוח לדוגמה" fallback="bank" method={wireMethod} agorot={1_500_000n} currency="USD" sign="in" href="/review/all?item=13" />,
    check: <ListRow key="check" variant="statement" title="קבלן לדוגמה" fallback="bank" method={checkMethod} pending agorot={-80_000n} currency="USD" sign="out" href="/review/all?item=14" />,
    none: <ListRow key="none" variant="statement" title="חשמל השרון בע״מ" fallback="bank" method={noMetaMethod} agorot={-120_050n} sign="out" href="/review/all?item=15" />,
  };
  return <List>{only ? rows[only] : Object.values(rows)}</List>;
}

function StatementSample({ kind }: { kind: "income" | "expense" | "pending" | "suggestion" | "long" | "fallback" | "all" }) {
  const rows = {
    income: <ListRow key="income" variant="statement" title="לקוח לדוגמה" fallback="invoice" method={invoiceMethod} agorot={500_000n} sign="in" href="/review/all?item=1" />,
    expense: <ListRow key="expense" variant="statement" title="חשמל השרון בע״מ" fallback="bank" method={bankMethod} agorot={-120_050n} sign="out" href="/review/all?item=2" />,
    pending: <ListRow key="pending" variant="statement" title="Northwind Traders" fallback="bank" method={cardMethod} pending agorot={-4_299n} currency="USD" sign="out" href="/review/all?item=3" />,
    suggestion: (
      <ListRow key="suggestion" variant="statement" title="שיש הגליל" fallback="invoice" method={invoiceMethod} suggestion="וילה לדוגמה · חומרים" agorot={-345_000n} sign="out" href="/review/all?item=4" />
    ),
    long: (
      <ListRow
        key="long"
        variant="statement"
        title="Contoso Building Supplies International"
        fallback="bank"
        method={bankMethod}
        pending
        suggestion={longHebrew}
        agorot={-999_999_999n}
        currency="USD"
        sign="out"
        href="/review/all?item=5"
      />
    ),
    fallback: <ListRow key="fallback" variant="statement" title="4242-1234" fallback="bank" method={bankMethod} agorot={-10_000n} sign="out" href="/review/all?item=6" />,
  };
  if (kind === "all") return <List>{Object.values(rows)}</List>;
  return <List>{rows[kind]}</List>;
}

const statementArgs = { variant: "transaction", title: "statement" } as const;
function statementFrame(width: "flow320" | "flow390", theme: "light" | "dark"): Pick<Story, "globals" | "parameters"> {
  return {
    ...(theme === "dark" ? { globals: { theme: "dark" as const } } : {}),
    parameters: { viewport: { defaultViewport: width } },
  };
}

export const StatementIncome: Story = { args: statementArgs, render: () => <StatementSample kind="income" /> };
export const StatementExpense: Story = { args: statementArgs, render: () => <StatementSample kind="expense" /> };
export const StatementPending: Story = { args: statementArgs, render: () => <StatementSample kind="pending" /> };
export const StatementSuggestion: Story = { args: statementArgs, render: () => <StatementSample kind="suggestion" /> };
export const StatementLongName: Story = { args: statementArgs, render: () => <StatementSample kind="long" /> };
export const StatementNoLetters: Story = { args: statementArgs, render: () => <StatementSample kind="fallback" /> };
export const StatementAll390: Story = { args: statementArgs, render: () => <StatementSample kind="all" />, ...statementFrame("flow390", "light") };
export const StatementAll390Dark: Story = { args: statementArgs, render: () => <StatementSample kind="all" />, ...statementFrame("flow390", "dark") };
export const StatementAll320: Story = { args: statementArgs, render: () => <StatementSample kind="all" />, ...statementFrame("flow320", "light") };
export const StatementAll320Dark: Story = { args: statementArgs, render: () => <StatementSample kind="all" />, ...statementFrame("flow320", "dark") };

export const StatementCard: Story = { args: statementArgs, render: () => <StatementBankRows only="card" /> };
export const StatementCardDark: Story = { args: statementArgs, render: () => <StatementBankRows only="card" />, globals: { theme: "dark" } };
export const StatementAch: Story = { args: statementArgs, render: () => <StatementBankRows only="ach" /> };
export const StatementAchDark: Story = { args: statementArgs, render: () => <StatementBankRows only="ach" />, globals: { theme: "dark" } };
export const StatementWire: Story = { args: statementArgs, render: () => <StatementBankRows only="wire" /> };
export const StatementWireDark: Story = { args: statementArgs, render: () => <StatementBankRows only="wire" />, globals: { theme: "dark" } };
export const StatementCheck: Story = { args: statementArgs, render: () => <StatementBankRows only="check" /> };
export const StatementCheckDark: Story = { args: statementArgs, render: () => <StatementBankRows only="check" />, globals: { theme: "dark" } };
export const StatementNoBankDetails: Story = { args: statementArgs, render: () => <StatementBankRows only="none" /> };
export const StatementNoBankDetailsDark: Story = { args: statementArgs, render: () => <StatementBankRows only="none" />, globals: { theme: "dark" } };
export const StatementMethods320: Story = { args: statementArgs, render: () => <StatementBankRows />, ...statementFrame("flow320", "light") };
export const StatementMethods320Dark: Story = { args: statementArgs, render: () => <StatementBankRows />, ...statementFrame("flow320", "dark") };

/** FLOW-501: a loan on the Loans page. The meta slot holds the balance with small cents; a waiting loan warns. */
function LoanRows() {
  return (
    <List>
      <ListRow
        variant="button"
        title="משכנתא אלון"
        icon={<BankIcon />}
        hint="וילה אלון"
        meta={<bdi className="ui-num ui-loan-amount" dir="ltr">$200,000<span className="ui-num-cents">.00</span></bdi>}
        chevron
        onClick={() => undefined}
      />
      <ListRow
        variant="button"
        title={longHebrew}
        icon={<BankIcon />}
        tone="warning"
        hint="ממתין לבדיקה · פרויקט גפן"
        wrapHint
        meta={<bdi className="ui-num ui-loan-amount" dir="ltr">₪50,000<span className="ui-num-cents">.00</span></bdi>}
        chevron
        onClick={() => undefined}
      />
      <ListRow
        variant="static"
        title="הלוואת ציוד"
        icon={<BankIcon />}
        meta={<bdi className="ui-num ui-loan-amount" dir="ltr">₪1,250<span className="ui-num-cents">.50</span></bdi>}
      />
    </List>
  );
}

export const LoanBalance: Story = {
  args: { variant: "button", title: "משכנתא אלון" },
  render: () => <LoanRows />,
};
export const LoanBalanceDark: Story = {
  args: { variant: "button", title: "משכנתא אלון" },
  globals: { theme: "dark" },
  render: () => <LoanRows />,
};
export const LoanBalance320: Story = {
  args: { variant: "button", title: "משכנתא אלון" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <LoanRows />,
};
