import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { BankIcon } from "./icons";
import { KeptOutTag, lineTagText } from "./line-marks";
import { List, ListRow, type ListLayout } from "./list-row";
import { largeAgorot, longHebrew, padded } from "./story-support";

/** Args are JSON: agorot is a decimal string, and the icon and the tag are flags the view draws. */
type RowArgs = {
  variant: "item" | "static" | "button" | "danger" | "skeleton" | "project" | "transaction" | "statement" | "radio";
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
  sign?: "in" | "out" | "cost" | "moved-in";
  source?: "invoice" | "bank";
  currency?: string;
  /** The radio control: the chosen row, its live description, the start-side marker, the reason it cannot be chosen. */
  selected?: boolean;
  description?: string;
  marker?: "start" | "end";
  disabledReason?: string;
};

const noop = () => undefined;

function RowView(args: RowArgs) {
  const layout = args.layout === "none" ? undefined : args.layout;
  const amount = BigInt(args.agorot ?? "0");
  if (args.variant === "statement") {
    return <ListRow variant="statement" title={args.title} fallback={args.source === "bank" ? "bank" : "invoice"} agorot={amount} sign={args.sign === "in" ? "in" : "out"} href={args.href ?? "/review/all?item=1"} setAside={args.setAside} />;
  }
  if (args.variant === "skeleton") return <ListRow variant="skeleton" icon={args.icon} />;
  if (args.variant === "radio") {
    return (
      <ListRow
        control="radio"
        title={args.title}
        hint={args.hint}
        description={args.description}
        marker={args.marker}
        disabled={args.disabled}
        disabledReason={args.disabledReason}
        busy={args.busy}
        selected={args.selected === true}
        onSelect={noop}
      />
    );
  }
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
  // Storybook 10 types `component` against the meta's args, and every story renders RowView.
  component: RowView,
  tags: ["autodocs"],
  decorators: [padded],
  args: { variant: "item", layout: "none", title: "ביטוח המגן", hint: "ספק · פטור ממע״מ" },
  argTypes: {
    variant: {
      control: "select",
      options: ["item", "static", "button", "danger", "skeleton", "project", "transaction", "statement", "radio"],
    },
    layout: { control: "select", options: ["none", "flat", "inset"] },
    tone: { control: "select", options: [undefined, "warning", "muted"] },
    chevron: { control: "boolean" },
    muted: { control: "boolean" },
    setAside: { control: "boolean" },
    busy: { control: "boolean" },
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
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
/** A choice-list row: the check circle at the end. Busy swaps the check for the spinner; a disabled reason replaces the description. */
export const Radio: Story = {
  args: { variant: "radio", title: "חודש קודם", hint: "אוגוסט 2026", selected: false },
};
export const RadioSelected: Story = {
  args: { variant: "radio", title: "החודש", hint: "ספטמבר 2026", selected: true },
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
export const Transaction: Story = {
  args: { variant: "transaction", title: "העברה", hint: "בנק · 12/09", agorot: "450000", sign: "out", source: "bank" },
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
/** FLOW-954: money in that is not income (a loan received, kept out of profit): "+" in the text colour, faded. */
export const MovedIn: Story = {
  args: { variant: "transaction", title: "Example Lending", hint: "08/10 · בית הדקל", agorot: "20650000", sign: "moved-in", source: "bank", setAside: true },
};
export const Muted: Story = {
  args: { variant: "item", title: "קטגוריה מוסתרת", hint: "מוסתרת", muted: true },
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

/** FLOW-366: a transaction row with the supplier's initials in place of the source icon, and the tag line under the hint: awaiting review, or left out of profit. */
export const TransactionTags: Story = {
  args: { variant: "transaction", title: "סטודיו גל", hint: "דירת הגפן · חומרים", agorot: "120000", sign: "out", source: "invoice" },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="סטודיו גל" hint="דירת הגפן · חומרים" agorot={120_000n} sign="out" source="invoice" initials="סג" href="/transactions/1" />
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
    </List>
  ),
};

/**
 * FLOW-168: at 320 a long project after the date is cut with "…" instead of dropping, Hebrew or Latin (a
 * Latin one is cut at its end). The date never shortens, and a part with no room at all still drops.
 */
export const LongProjectHint: Story = {
  args: { variant: "transaction", title: "ספק לדוגמה", layout: "flat" },
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="18/10 · מתחם המגורים הגדול ברחוב הדקל שלב ב" agorot={120_000n} sign="out" source="invoice" initials="סל" href="/transactions/1" />
      <ListRow layout="flat" variant="transaction" title="Example Hardware" hint="18/10 · Riverside Commons Phase Two Townhomes" agorot={40_000n} sign="out" source="bank" initials="EH" href="/transactions/2" />
      <ListRow layout="flat" variant="transaction" title="אור חשמל" hint="מתחם המגורים הגדול ברחוב הדקל שלב ב · 03/10 · חשמל" agorot={86_000n} sign="out" source="invoice" initials="אח" href="/transactions/3" />
      <ListRow layout="flat" variant="transaction" title="העברה" hint="10/09 · בית הים" agorot={450_000n} sign="out" source="bank" initials="הע" href="/transactions/4" />
    </List>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    const lines = [...canvasElement.querySelectorAll(".ui-row")].map((row) => {
      const parts = [...row.querySelectorAll(".ui-hint-part")];
      const top = parts[0]?.getBoundingClientRect().top ?? 0;
      return parts
        .filter((part) => Math.abs(part.getBoundingClientRect().top - top) < 1)
        .map((part) => {
          const text = part.querySelector(".ui-hint-text");
          const cut = text instanceof HTMLElement && text.scrollWidth > text.clientWidth + 1;
          return `${part.textContent}${cut ? "…" : ""}`;
        });
    });
    await expect(lines).toEqual([
      ["18/10", " · מתחם המגורים הגדול ברחוב הדקל שלב ב…"],
      ["18/10", " · Riverside Commons Phase Two Townhomes…"],
      // The first part too long for the line is cut on its own; the date after it drops whole.
      ["מתחם המגורים הגדול ברחוב הדקל שלב ב…"],
      ["10/09", " · בית הים"],
    ]);
    // A Latin part runs left to right, so its start stays in view.
    await expect(within(canvasElement).getByText("Riverside Commons Phase Two Townhomes")).toHaveAttribute("dir", "auto");
  },
};

/**
 * FLOW-172: a cut part ends at its last letter that fits, then "…": never "Quick …" with a space before it,
 * nor a comma. The whole text stays in the DOM for screen readers; the cut is drawn over it (`data-cut`).
 */
export const CutAtALetter: Story = {
  args: { variant: "transaction", title: "ספק לדוגמה", layout: "flat" },
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="Water heater replacement" hint="18/10 · Quick Fix Plumbing · Cedar St" agorot={125_000n} sign="out" source="bank" initials="QF" href="/transactions/1" />
      <ListRow layout="flat" variant="transaction" title="אור חשמל" hint="03/10 · חשמל ותאורה, קומה ב" agorot={86_000n} sign="out" source="invoice" initials="אח" href="/transactions/2" />
      <ListRow layout="flat" variant="transaction" title="אור חשמל" hint="03/10 · חשמל ותאורה קומה ב" agorot={86_000n} sign="out" source="invoice" initials="אח" href="/transactions/3" />
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="18/10 · Quick Fix Mainline" agorot={125_000n} sign="out" source="bank" initials="QF" href="/transactions/4" />
      <ListRow layout="flat" variant="transaction" title="Example Hardware" hint="18/10 · A B C D E F G H I J K L M N O P" agorot={40_000n} sign="out" source="bank" initials="EH" href="/transactions/5" />
      <ListRow layout="flat" variant="transaction" title="Example Hardware" hint="18/10 · AB C D E F G H I J K L M N O P" agorot={40_000n} sign="out" source="bank" initials="EH" href="/transactions/6" />
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="03/10 · א ב ג ד ה ו ז ח ט י כ ל מ נ ס ע" agorot={86_000n} sign="out" source="invoice" initials="סל" href="/transactions/7" />
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="03/10 · אב ג ד ה ו ז ח ט י כ ל מ נ ס ע" agorot={86_000n} sign="out" source="invoice" initials="סל" href="/transactions/8" />
    </List>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    // The measuring loads once; the shared observer reports after layout, and a font that arrives measures again.
    await canvasElement.ownerDocument.fonts.ready;
    await waitFor(() => expect(canvasElement.querySelectorAll(".ui-hint-text[data-cut]").length).toBeGreaterThanOrEqual(6));
    for (let frame = 0; frame < 2; frame += 1) await new Promise((done) => requestAnimationFrame(done));
    let atBoundary = 0;
    for (const row of canvasElement.querySelectorAll(".ui-row")) {
      const texts = [...row.querySelectorAll<HTMLElement>(".ui-hint-text")];
      const top = texts[0]?.getBoundingClientRect().top ?? 0;
      for (const text of texts.filter((item) => Math.abs(item.getBoundingClientRect().top - top) < 1)) {
        if (text.scrollWidth <= text.clientWidth + 1) continue;
        // What is drawn: the overlay's text (the whole text below it is unpainted, its own "…" too).
        await expect(getComputedStyle(text).webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
        const drawn = /^"(.*?)"/u.exec(getComputedStyle(text, "::after").content)?.[1] ?? "";
        await expect(drawn).toMatch(/[^\s,;:\-–]…$/u);
        const kept = drawn.slice(0, -1);
        const whole = text.textContent;
        await expect(whole.startsWith(kept)).toBe(true);
        // Its "…" sits where a space or a comma follows in the text: there CSS's own "…" kept it.
        if (/^[\s,]/u.test(whole.slice(kept.length))) atBoundary += 1;
      }
    }
    await expect(atBoundary).toBeGreaterThanOrEqual(2);
  },
};

/**
 * FLOW-168 as it stands (review of #865): with three parts whose 2nd and 3rd both have letters, both can be
 * cut on one line at 393. The parts past the first that do not fit are cut or dropped, not only one.
 */
export const TwoCutParts: Story = {
  args: { variant: "transaction", title: "ספק לדוגמה", layout: "flat" },
  globals: { viewport: { value: "flow393", isRotated: false } },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="ספק לדוגמה" hint="קרן · מתחם המגורים הגדול ברחוב הדקל שלב ב · תיקונים ותחזוקה שוטפת" agorot={120_000n} sign="out" source="invoice" initials="סל" href="/transactions/1" />
    </List>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBe(393);
    const parts = [...canvasElement.querySelectorAll(".ui-hint-part")];
    const top = parts[0]?.getBoundingClientRect().top ?? 0;
    const shown = parts.map((part) => {
      const text = part.querySelector(".ui-hint-text");
      return {
        line1: Math.abs(part.getBoundingClientRect().top - top) < 1,
        cut: text instanceof HTMLElement && text.scrollWidth > text.clientWidth + 1,
      };
    });
    await expect(shown).toEqual([
      { line1: true, cut: false },
      { line1: true, cut: true },
      { line1: true, cut: true },
    ]);
  },
};

/**
 * FLOW-167: a title a search found in a description wraps, at most three lines, and a snippet keeps the
 * whole text for screen readers (`titleFull`). clip-check measures width only, so the play checks the lines.
 */
export const WrapTitle: Story = {
  args: { variant: "transaction", title: "…parts, labour, inspection 120", layout: "flat" },
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <List layout="flat">
      <ListRow layout="flat" variant="transaction" title="…parts, labour, inspection 120" titleFull="Quarterly service visit for the boiler room and the shared laundry on the ground floor, parts, labour, inspection 120" wrapTitle hint="06/08 · Northside Hardware" agorot={50_000n} sign="out" source="bank" initials="NH" href="/transactions/1" />
      <ListRow layout="flat" variant="transaction" title="ביקור שירות רבעוני בחדר הדודים ובחדר הכביסה המשותף בקומת הקרקע, כולל חלקים, עבודה, ניקוי המסננים ובדיקת המעלית בבניין" wrapTitle hint="03/08 · Bright Electric" agorot={70_000n} sign="out" source="invoice" initials="BE" href="/transactions/2" />
    </List>
  ),
  play: async ({ canvasElement }) => {
    const titles = [...canvasElement.querySelectorAll(".ui-row-title")];
    for (const title of titles) {
      const lines = Math.round(title.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(title).lineHeight));
      await expect(lines).toBeLessThanOrEqual(3);
    }
    await expect(within(canvasElement).getAllByRole("link")[0]).toHaveTextContent("Quarterly service visit");
  },
};
