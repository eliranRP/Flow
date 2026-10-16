import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard, type ReviewSplitSummary } from "./review-card";
import { jevReasonText, reviewFlagView, reviewPaidView, type JevReasonKind, type ReviewFlag } from "../review-copy";
import { expect, userEvent, within } from "@storybook/test";
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
  /** FLOW-365: the source pill, the split summary and a transfer. */
  sourcePill?: string;
  splitSummary?: ReviewSplitSummary;
  transfer?: boolean;
};

function CardView({
  supplier, sourceLine, netAgorot, vatLine, project, category, confidence, reason, meta, currency, projectJev, categoryJev,
  splitParts, why, partyFilings = 5, matchingFilings = 3, flags, direction, missingBoth, projectNoneJev, filled,
  receipts, paid, paidOn, editable, sourcePill, splitSummary, transfer,
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
      transfer={transfer}
      onSplit={splitSummary == null && !transfer ? () => undefined : undefined}
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

export const NoSuggestion: Story = {
  args: {
    supplier: "חומרי בניין לדוגמה בע״מ",
    sourceLine: "הוצאה · 12/04/2026",
    netAgorot: "-2200000",
    vatLine: "לפני מע״מ · מע״מ ₪3,960",
  },
};

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

export const MissingCategory: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
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

export const Suggestion: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
    category: "חומרים",
  },
};

export const NoScore: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
    category: "חומרים",
    confidence: 92,
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

export const MetaNone: Story = {
  name: "Meta: none (today)",
  args: { ...mercuryCard, meta: storyMeta("t1", {}) },
};

export const MetaCard: Story = {
  name: "Meta: card",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "card", card_last4: "4242" }) },
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
export const MetaCardLongName320: Story = {
  parameters: { viewport: { defaultViewport: "flow320" } },
  name: "Meta: card with a long name, 320",
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

/** A transfer names the account it left from, without the account's last 4. */
export const MetaAchAccount: Story = {
  name: "Meta: ACH from a named account",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "ach", account: "Operating ••1234" }) },
};

export const MetaAchMemo: Story = {
  name: "Meta: ACH and memo",
  args: {
    ...mercuryCard,
    meta: storyMeta("t1", { method: "ach", memo: "Invoice 1042 for the September office lease, parking, and storage" }),
  },
};

export const MetaAchMemoOpen: Story = {
  name: "Meta: ACH and memo, open",
  args: MetaAchMemo.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^הערה:/ }));
  },
};

export const MetaWire: Story = {
  name: "Meta: wire",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "wire" }) },
};

export const MetaHebrewMemo: Story = {
  name: "Meta: Hebrew memo",
  args: {
    ...mercuryCard,
    meta: storyMeta("t1", { method: "card", card_last4: "4242", memo: "תשלום על חשבונית 1042 עבור שכירות משרד חודש ספטמבר" }),
  },
};

/** הצעת Jev marks the field whose value Jev filled. Invented data. */
const jevCard = { ...OneCard.args, project: "וילה רעננה", category: "חומרים" };
const narrow = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const JevProject: Story = { name: "Jev: project", args: { ...jevCard, projectJev: true } };

export const JevCategory: Story = { name: "Jev: category", args: { ...jevCard, categoryJev: true } };

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
export const SplitMismatchOnePart: Story = { args: { ...splitMismatchArgs, splitParts: 1 } };
export const SplitMismatchPartsLoading: Story = { args: { ...splitMismatchArgs, splitParts: "loading" } };

/** FLOW-333 C8: both fields empty, so אישור is off and this line says why. */
export const BothMissingHint: Story = { args: { ...OneCard.args, missingBoth: true } };

/** FLOW-327 / 0134: Jev's reason, one line under the rows. Invented data. */
const jevBoth = { ...jevCard, projectJev: true, categoryJev: true };
export const JevReasonSameAsLast: Story = { name: "Jev reason: same as last", args: { ...jevBoth, why: "same_as_last" } };
export const JevReasonUsual: Story = { name: "Jev reason: usual for party", args: { ...jevBoth, why: "usual_for_party", partyFilings: 5, matchingFilings: 3 } };
export const JevReasonNewParty: Story = { name: "Jev reason: new party", args: { ...jevBoth, why: "new_party" } };
export const JevReasonNewPartyIncome: Story = { name: "Jev reason: new party, income", args: { ...jevBoth, why: "new_party", direction: "income", netAgorot: "1850000" } };
export const JevReasonModelOnly: Story = { name: "Jev reason: model only", args: { ...jevBoth, why: "model_only" } };

/** FLOW-703: Jev's answer is "no project"; the field shows it with the pill. */
export const JevNoProject: Story = { name: "Jev: no project", args: { ...OneCard.args, category: "משרד", categoryJev: true, projectNoneJev: true, why: "usual_for_party" } };

/** FLOW-327 / 0131: one flag per card, loud from a Jev score of 0.7. Invented data. */
const flag = (kind: ReviewFlag["kind"], score: number | null, extra: Partial<ReviewFlag> = {}): ReviewFlag => ({
  transaction_id: "t1", kind, jev_score: score, ...extra,
});
export const FlagDuplicateLoud: Story = { name: "Flag: duplicate, loud", args: { ...jevCard, flags: [flag("duplicate", 0.86, { other_doc_date: "2026-10-03" })] } };
/** 2026-10-09 option A: "↑ 240%" right after the amount and "בדרך כלל ₪2,500" under it; no flag row beside the pill. */
export const FlagSpikeLoud: Story = { name: "Flag: amount spike, loud", args: { ...jevCard, flags: [flag("amount_spike", 0.74, { ratio: 3.4, typical_amount_minor: 250_000 })] } };
export const FlagSpikeQuiet: Story = { name: "Flag: amount spike, quiet", args: { ...jevCard, flags: [flag("amount_spike", 0.4, { ratio: 3.4, typical_amount_minor: 250_000 })] } };
/** With no ratio there is no pill: the quiet line stays, and the usual amount still sits under the amount. */
export const FlagSpikeNoRatio: Story = { name: "Flag: amount spike, quiet, no ratio", args: { ...jevCard, flags: [flag("amount_spike", null, { typical_amount_minor: 250_000 })] } };
/** At 320 a long amount may leave no room: the pill drops under it, and the amount is never cut. */
export const FlagSpikeLong320: Story = {
  ...narrow,
  name: "Flag: amount spike, long amount, 320",
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
export const FlagDuplicateQuiet: Story = { name: "Flag: duplicate, quiet", args: { ...jevCard, flags: [flag("duplicate", 0.4, { other_doc_date: "2026-10-03" })] } };
export const FlagSpikeQuietIncome: Story = { name: "Flag: amount spike, quiet, income", args: { ...jevCard, direction: "income", flags: [flag("amount_spike", 0.5, { ratio: 3 })] } };
export const FlagNewPartyUnscored: Story = { name: "Flag: new party, unscored (Jev off)", args: { ...jevCard, flags: [flag("new_party_large", null)] } };
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
export const JevFilled320: Story = { ...narrow, name: "Jev filled: undo, 320", args: JevFilled.args, play: JevFilled.play };
export const JevFilledBusy: Story = { name: "Jev filled: undo running", args: { ...JevFilled.args, filled: "busy" } };
export const JevFilledViewer: Story = { name: "Jev filled: viewer", args: { ...JevFilled.args, filled: "label" } };
export const JevFilledFlag: Story = { name: "Jev filled: with quiet flag", args: { ...JevFilled.args, flags: [flag("duplicate", 0.3, { other_doc_date: "2026-10-03" })] } };
// FLOW-702 plan item 3: the anomaly gate held the auto fill back. The flag shows, the values stay suggestions, no fill line.
export const JevAutoHeldFlag: Story = { name: "Jev auto: held flagged line", args: { ...jevBoth, why: "usual_for_party", flags: [flag("duplicate", 0.8, { other_doc_date: "2026-10-03" })] } };
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

/** A part payment: the receipts don't cover the invoice yet. No ✓, the latest receipt's date. */
export const PairPartPaid: Story = {
  name: "Pair: part paid",
  args: { ...pairCard, receipts: ["2026-10-06", "2026-10-12"], paid: false, paidOn: "2026-10-12" },
};

/** An invoice with no receipt yet: no line. */
export const PairUnpaid: Story = { name: "Pair: unpaid invoice", args: { ...pairCard, receipts: [], paid: false, paidOn: null } };

/** A receipt whose invoice isn't in Flow is a card like any other, with no line. */
export const PairReceiptOnly: Story = {
  name: "Pair: receipt only",
  args: { ...pairCard, sourceLine: "הכנסה · 12/10/2026", vatLine: "", receipts: [], paid: false, paidOn: null },
};

/** Stress: a supplier name that takes three lines at 320 wraps whole; a fourth line would end in an ellipsis. */
export const SupplierThreeLines: Story = {
  name: "Stress: supplier on three lines",
  args: {
    ...jevCard,
    editable: true,
    supplier: "חברת ההובלות והשינוע לדוגמה בע״מ סניף צפון",
  },
};

/** FLOW-352 1 (cycle 11): beside the הצעה pill at 320 a long value wraps to a second line. Invented names. */
const longValueCard = { ...OneCard.args, project: "וילה הדקלים", category: "חומרי גמר וצבע", editable: true };
export const ValueWraps: Story = { name: "Stress: value on two lines beside הצעה", args: longValueCard };

const usdSplit: ReviewSplitSummary = {
  total: "$1,284.50",
  parts: [
    { key: "a", amount: "$340.00", project: "שיפוץ הרצל 12", category: "ציוד והשכרה" },
    { key: "b", amount: "$420.00", project: "וילה רעננה", category: "חומרים" },
    { key: "c", amount: "$524.50", project: "שיפוץ הרצל 12", category: "חומרים" },
  ],
};

/** FLOW-365 states: a suggestion, no suggestion, a split summary, a transfer and a photo, in USD. */
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
export const ReviewStateTransfer: Story = {
  name: "Review state: transfer",
  args: { supplier: "העברה בין חשבונות לדוגמה", sourceLine: "העברה · 12/10/2026", netAgorot: "-500000", currency: "USD", vatLine: "לפני מע״מ", sourcePill: "שורת בנק", transfer: true },
};
export const ReviewStatePhoto: Story = {
  name: "Review state: photo invoice",
  args: { supplier: "מחסן לדוגמה", sourceLine: "חשבונית · 12/10/2026", netAgorot: "-64200", currency: "USD", vatLine: "לפני מע״מ", sourcePill: "חשבונית מצולמת" },
};
