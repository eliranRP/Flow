import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard, type ReviewSplitSummary } from "./review-card";
import { jevReasonText, reviewFlagView, reviewPaidView, type JevReasonKind, type ReviewFlag } from "../review-copy";
import { expect } from "@storybook/test";
import type { TxnMeta } from "../txn-meta";
import { padded, storyMeta } from "./story-support";

type CardArgs = {
  supplier: string;
  sourceLine: string;
  netAgorot: string;
  vatLine: string;
  project?: string;
  category?: string;
  confidence?: number;
  reason?: string;
  meta?: TxnMeta;
  currency?: string;
  /** Jev filled the suggested project or category: הצעת Jev instead of הצעה. */
  projectJev?: boolean;
  categoryJev?: boolean;
  /** FLOW-327: a split_mismatch card names the parts; "loading" while the split is read. */
  splitParts?: number | "loading";
  /** FLOW-327: Jev's reason line (decision 0134). */
  why?: JevReasonKind;
  partyFilings?: number;
  matchingFilings?: number;
  /** FLOW-327: the anomaly flags (decision 0131); the card shows at most one. */
  flags?: ReviewFlag[];
  direction?: "income" | "expense";
  /** FLOW-327 / C8: the hint under the rows when both fields are empty. */
  missingBoth?: boolean;
  /** FLOW-703: Jev answered "no project". */
  projectNoneJev?: boolean;
  /** FLOW-702: the auto job's fill stands. "label" is a viewer's card, with no ביטול. */
  filled?: "undo" | "label" | "busy" | "off";
  /** FLOW-309 (0165): the invoice's paired receipts (dates), whether they cover it, and the latest date. */
  receipts?: string[];
  paid?: boolean;
  paidOn?: string | null;
  /** The field rows open their pickers (chevrons), as on the review screen. */
  editable?: boolean;
  /** FLOW-365: the source pill and the split summary. */
  sourcePill?: string;
  splitSummary?: ReviewSplitSummary;
};

function CardView({
  supplier, sourceLine, netAgorot, vatLine, project, category, confidence, reason, meta, currency, projectJev, categoryJev,
  splitParts, why, partyFilings = 5, matchingFilings = 3, flags, direction, missingBoth, projectNoneJev, filled,
  receipts, paid, paidOn, editable, sourcePill, splitSummary,
}: CardArgs) {
  const shared = reason === "unallocated_shared";
  const suggestion = project || category || projectNoneJev
    ? {
        project,
        category,
        confidence,
        projectSuggested: Boolean(project) && !shared,
        categorySuggested: Boolean(category),
        projectJev,
        categoryJev,
        projectNoneJev,
      }
    : undefined;
  const jevWhy = why ? jevReasonText({ reason: why, partyFilings, matchingFilings }, direction) : null;
  return (
    <ReviewCard
      supplier={supplier}
      sourceLine={sourceLine}
      netAgorot={BigInt(netAgorot)}
      vatLine={vatLine}
      suggestion={suggestion}
      reason={reason}
      meta={meta}
      currency={currency}
      onProject={editable || projectJev || categoryJev || filled != null ? () => undefined : undefined}
      onCategory={editable || projectJev || categoryJev || filled != null ? () => undefined : undefined}
      splitParts={splitParts}
      sourcePill={sourcePill}
      splitSummary={splitSummary}
      onSplit={splitSummary == null ? () => undefined : undefined}
      jevWhy={jevWhy}
      flag={reviewFlagView(flags, { direction, currency })}
      direction={direction}
      missingBoth={missingBoth}
      jevFilled={filled == null ? null : filled === "label" ? {} : { busy: filled === "busy", alone: filled === "off", onUndo: () => undefined }}
      paid={reviewPaidView({
        receipts: receipts?.map((doc_date) => ({ doc_date })),
        paid,
        paid_on: paidOn,
      })}
    />
  );
}

const meta = {
  title: "Components/ReviewCard",
  component: CardView,
  decorators: [padded],
} satisfies Meta<typeof CardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneCard: Story = {
  args: {
    supplier: "חומרי בניין לדוגמה בע״מ",
    sourceLine: "חשבונית · 21/09/2026",
    netAgorot: "-850000",
    vatLine: "לפני מע״מ · מע״מ ₪1,530",
  },
};

export const MissingProject: Story = {
  args: {
    ...OneCard.args,
    category: "חומרים",
  },
};

/** FLOW-312 item 2 / 0125: the bank changed a split line's amount, so the parts no longer match. */
const splitMismatchArgs = {
  ...OneCard.args,
  project: "וילה רעננה",
  category: "חומרים",
  reason: "split_mismatch",
};

export const SharedCost: Story = {
  args: {
    ...OneCard.args,
    category: "חומרים",
    reason: "unallocated_shared",
  },
};

/** FLOW-304. Bank details. A USD Mercury line has no VAT line. */
const mercuryCard = {
  supplier: "Example Office Suite",
  sourceLine: "הוצאה · 12/09/2026",
  netAgorot: "-125000",
  currency: "USD",
  vatLine: "",
  project: "Cedar Lot",
  category: "Office",
};

/** FLOW-439: the card's nickname from the bank after its last 4. Invented names. */
export const MetaCardName: Story = {
  name: "Meta: card with its name",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "card", card_last4: "8408", card_name: "כרטיס חשמל" }) },
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector(".ui-review-meta");
    await expect(line?.textContent).toBe("••8408כרטיס שמסתיים ב־8408·כרטיס חשמל");
  },
};

/** A name too long for the line ellipsizes; the last 4 stays whole. */
export const MetaCardLongName: Story = {
  name: "Meta: card with a long name",
  args: {
    ...mercuryCard,
    meta: storyMeta("t1", { method: "card", card_last4: "8408", card_name: "Utilities card for the duplex on Maple Street" }),
  },
  play: async ({ canvasElement }) => {
    const name = canvasElement.querySelector<HTMLElement>(".ui-review-meta-name");
    const last4 = canvasElement.querySelector<HTMLElement>(".ui-review-meta .ui-num");
    await expect(name != null && name.scrollWidth > name.clientWidth).toBe(true);
    await expect(last4 != null && last4.scrollWidth <= last4.clientWidth).toBe(true);
  },
};

/** הצעת Jev marks the field whose value Jev filled. Invented data. */
const jevCard = { ...OneCard.args, project: "וילה רעננה", category: "חומרים" };

export const JevBoth: Story = { name: "Jev: both", args: { ...jevCard, projectJev: true, categoryJev: true } };

/** A long value is cut with an ellipsis; the pill and the chevron stay on the row. */
export const JevBothLong: Story = {
  name: "Jev: both, long names",
  args: {
    ...JevBoth.args,
    supplier: "ספק חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי",
    project: "וילה רעננה — שיפוץ מלא של הקומה העליונה והחצר האחורית",
    category: "חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי והסביבה הקרובה",
  },
};

/** FLOW-327 item 3: the mismatch card names the parts in one row; the actions sit in the bar. */
export const SplitMismatchParts: Story = { args: { ...splitMismatchArgs, splitParts: 2 } };

/** FLOW-333 C8: both fields empty, so אישור is off and this line says why. */
export const BothMissingHint: Story = { args: { ...OneCard.args, missingBoth: true } };

/** FLOW-327 / 0134: Jev's reason, one line under the rows. Invented data. */
const jevBoth = { ...jevCard, projectJev: true, categoryJev: true };
export const JevReasonUsual: Story = { name: "Jev reason: usual for party", args: { ...jevBoth, why: "usual_for_party", partyFilings: 5, matchingFilings: 3 } };

/** FLOW-703: Jev's answer is "no project"; the field shows it with the pill. */
export const JevNoProject: Story = { name: "Jev: no project", args: { ...OneCard.args, category: "משרד", categoryJev: true, projectNoneJev: true, why: "usual_for_party" } };

/** FLOW-327 / 0131: one flag per card, loud from a Jev score of 0.7. Invented data. */
const flag = (kind: ReviewFlag["kind"], score: number | null, extra: Partial<ReviewFlag> = {}): ReviewFlag => ({
  transaction_id: "t1", kind, jev_score: score, ...extra,
});
export const FlagSpikeQuiet: Story = { name: "Flag: amount spike, quiet", args: { ...jevCard, flags: [flag("amount_spike", 0.4, { ratio: 3.4, typical_amount_minor: 250_000 })] } };
/** A long amount may leave no room: the pill drops under it, and the amount is never cut. */
export const FlagSpikeLongAmount: Story = {
  name: "Flag: amount spike, long amount",
  args: { ...jevCard, projectJev: true, categoryJev: true, netAgorot: "-123456700", flags: [flag("amount_spike", 0.4, { ratio: 12.5, typical_amount_minor: 9_876_500 })] },
  play: async ({ canvasElement }) => {
    const amount = canvasElement.querySelector<HTMLElement>(".ui-review-amount > .t-display");
    const pill = canvasElement.querySelector<HTMLElement>(".ui-review-spike");
    await expect(amount).not.toBeNull();
    await expect(pill).not.toBeNull();
    await document.fonts.ready;
    const amountBox = (amount as HTMLElement).getBoundingClientRect();
    const cardEl = canvasElement.querySelector(".ui-review") as HTMLElement;
    const outer = cardEl.getBoundingClientRect();
    const style = getComputedStyle(cardEl);
    // The card's content box: an amount spilling into the padding counts as cut.
    const card = { left: outer.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth), right: outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) };
    const pillBox = (pill as HTMLElement).getBoundingClientRect();
    // The amount is never cut, and the pill stays inside the card: beside the amount when it fits, else under it.
    await expect(amountBox.left).toBeGreaterThanOrEqual(card.left - 0.5);
    await expect(amountBox.right).toBeLessThanOrEqual(card.right + 0.5);
    await expect(pillBox.left).toBeGreaterThanOrEqual(card.left - 0.5);
    await expect(pillBox.right).toBeLessThanOrEqual(card.right + 0.5);
    const beside = pillBox.top < amountBox.bottom - 1;
    if (beside) await expect(pillBox.right <= amountBox.left || pillBox.left >= amountBox.right).toBe(true);
    else await expect(pillBox.top).toBeGreaterThanOrEqual(amountBox.bottom - 1);
  },
};
export const FlagNewPartyLoudIncome: Story = { name: "Flag: new party, loud, income", args: { ...jevCard, direction: "income", netAgorot: "4800000", flags: [flag("new_party_large", 0.9)] } };
export const FlagWithJevReason: Story = { name: "Flag: loud, with Jev reason", args: { ...jevBoth, why: "usual_for_party", flags: [flag("amount_spike", 0.8, { ratio: 3.1, typical_amount_minor: 95_000 })] } };

// FLOW-702: the auto job filled the line. "✦ מולא ע״י Jev" with ביטול at the end, one line, no reason.
/**
 * FLOW-339 C6-3: ביטול's 44px hit area grows down and sideways from the filled line, never up into the
 * category row, so a tap at the row's bottom edge opens the row and never undoes the fill.
 */
export const JevFilled: Story = {
  name: "Jev filled: undo",
  args: { ...jevBoth, why: "usual_for_party", filled: "undo" },
  play: async ({ canvasElement }) => {
    const undo = canvasElement.querySelector<HTMLElement>(".ui-review-filled-undo");
    await expect(undo).not.toBeNull();
    const box = (undo as HTMLElement).getBoundingClientRect();
    const x = box.left + box.width / 2;
    for (const dy of [1, 4, 8, 13]) {
      await expect(document.elementFromPoint(x, box.top - dy)?.closest(".ui-review-filled-undo")).toBeNull();
    }
    await expect(document.elementFromPoint(x, box.bottom + 10)?.closest(".ui-review-filled-undo")).not.toBeNull();
  },
};
// FLOW-706: Jev is off. The stored values with הצעה, no הצעת Jev pill, and the fill still undoable.
export const JevFilledOff: Story = { name: "Jev filled: Jev off", args: { ...jevCard, filled: "off" } };

/**
 * FLOW-309 option A (decision 0165): a connector invoice and its receipt are one card. Invented data;
 * every story sees 2026-10-15, so the dates are this year's dd/mm.
 */
const pairCard = {
  supplier: "לקוח לדוגמה",
  sourceLine: "הכנסה · 05/10/2026",
  netAgorot: "1200000",
  vatLine: "לפני מע״מ · מע״מ ₪2,160",
  direction: "income" as const,
  project: "וילה לדוגמה",
  category: "עבודה",
  editable: true,
};

export const PairPaid: Story = { name: "Pair: paid", args: { ...pairCard, receipts: ["2026-10-12"], paid: true, paidOn: "2026-10-12" } };

const usdSplit: ReviewSplitSummary = {
  total: "$1,284.50",
  parts: [
    { key: "a", amount: "$340.00", project: "שיפוץ הרצל 12", category: "ציוד והשכרה" },
    { key: "b", amount: "$420.00", project: "וילה רעננה", category: "חומרים" },
    { key: "c", amount: "$524.50", project: "שיפוץ הרצל 12", category: "חומרים" },
  ],
};

/** FLOW-365 states: a suggestion, no suggestion, a split summary and a photo, in USD. */
export const ReviewStateSuggestion: Story = {
  name: "Review state: suggestion",
  args: { supplier: "חומרי בניין לדוגמה", sourceLine: "הוצאה · 12/10/2026", netAgorot: "-128450", currency: "USD", vatLine: "לפני מע״מ", project: "שיפוץ הרצל 12", category: "חומרים", projectJev: true, categoryJev: true, sourcePill: "שורת בנק" },
};
export const ReviewStateNoSuggestion: Story = {
  name: "Review state: no suggestion",
  args: { supplier: "חומרי בניין לדוגמה", sourceLine: "הוצאה · 12/10/2026", netAgorot: "-128450", currency: "USD", vatLine: "לפני מע״מ", sourcePill: "שורת בנק" },
};
export const ReviewStateSplit: Story = {
  name: "Review state: split summary",
  args: { supplier: "ציוד משותף לדוגמה", sourceLine: "הוצאה · 12/10/2026", netAgorot: "-128450", currency: "USD", vatLine: "לפני מע״מ", sourcePill: "שורת בנק", splitSummary: usdSplit },
};
export const ReviewStatePhoto: Story = {
  name: "Review state: photo invoice",
  args: { supplier: "מחסן לדוגמה", sourceLine: "חשבונית · 12/10/2026", netAgorot: "-64200", currency: "USD", vatLine: "לפני מע״מ", sourcePill: "חשבונית מצולמת" },
};
